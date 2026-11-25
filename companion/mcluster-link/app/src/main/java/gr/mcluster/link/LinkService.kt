package gr.mcluster.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.ContentApi
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.protocol.types.Image
import com.spotify.protocol.types.ImageUri
import com.spotify.protocol.types.ListItem
import com.spotify.protocol.types.ListItems
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * The link: a small web server on port 8766. The car (M Cluster), joined to this phone's hotspot, calls it:
 * /ping, /browse (Spotify's lists: the top sections, then playlists, albums, Liked Songs), /img (a row's picture,
 * small JPEG) and /play. It does them with the Spotify app through Spotify's App Remote SDK. Every call must carry
 * the 4-digit code the iDrive shows. Runs in the foreground (a notification) so it keeps going with the screen off.
 */
class LinkService : Service() {
    companion object {
        const val REDIRECT = "mcluster-link://callback"
        const val PORT = 8766
        @Volatile var status: String = "Stopped"
        @Volatile var spotifyError: String? = null
    }

    @Volatile private var running = false
    @Volatile private var remote: SpotifyAppRemote? = null
    @Volatile private var connecting = false
    @Volatile private var lastCar = 0L
    private var server: ServerSocket? = null
    private val pool = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = notification("Starting")
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else startForeground(1, n)
        if (!running) {
            running = true
            Thread { serve() }.start()
            Thread { watch() }.start()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        try { server?.close() } catch (e: Exception) { }
        remote?.let { SpotifyAppRemote.disconnect(it) }
        remote = null
        status = "Stopped"
        super.onDestroy()
    }

    private fun prefs() = getSharedPreferences("link", MODE_PRIVATE)

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("link", "M Cluster Link", NotificationManager.IMPORTANCE_LOW))
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, "link")
            .setContentTitle("M Cluster Link")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    private fun setStatus(t: String) {
        if (t == status) return
        status = t
        try { getSystemService(NotificationManager::class.java).notify(1, notification(t)) } catch (e: Exception) { }
    }

    private fun spotifyOk() = remote?.isConnected == true

    private fun connectSpotify() {
        if (spotifyOk() || connecting) return
        val id = prefs().getString("clientId", "") ?: ""
        if (id.isEmpty()) { spotifyError = "no Client ID"; return }
        connecting = true
        val params = ConnectionParams.Builder(id).setRedirectUri(REDIRECT).showAuthView(false).build()
        main.post {
            SpotifyAppRemote.connect(this, params, object : Connector.ConnectionListener {
                override fun onConnected(r: SpotifyAppRemote) { remote = r; connecting = false; spotifyError = null }
                override fun onFailure(t: Throwable) { remote = null; connecting = false; spotifyError = t.javaClass.simpleName + ": " + (t.message ?: "") }
            })
        }
    }

    /** Keeps Spotify connected and the status line current. */
    private fun watch() {
        var lastTry = 0L
        while (running) {
            if (!spotifyOk() && System.currentTimeMillis() - lastTry > 10000) { lastTry = System.currentTimeMillis(); connectSpotify() }
            val car = System.currentTimeMillis() - lastCar < 10000
            setStatus((if (car) "Car linked" else "Waiting for the car (hotspot on, iDrive joined to it)") +
                "; Spotify " + (if (spotifyOk()) "connected" else "not connected"))
            try { Thread.sleep(1000) } catch (e: Exception) { }
        }
    }

    private fun serve() {
        while (running) {
            try {
                ServerSocket(PORT).use { ss ->
                    server = ss
                    while (running) {
                        val s = ss.accept()
                        pool.execute { handle(s) }
                    }
                }
            } catch (e: Exception) {
                if (running) { setStatus("Server: " + (e.message ?: e.javaClass.simpleName)); try { Thread.sleep(2000) } catch (x: Exception) { } }
            }
        }
    }

    private fun handle(s: Socket) {
        s.use { sock ->
            try {
                sock.soTimeout = 10000
                val reader = sock.getInputStream().bufferedReader(Charsets.UTF_8)
                val line = reader.readLine() ?: return
                while (true) { val h = reader.readLine() ?: break; if (h.isEmpty()) break }   // the headers: not needed
                val target = line.split(" ").getOrElse(1) { "/" }
                val path = target.substringBefore('?')
                val q = HashMap<String, String>()
                target.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.forEach {
                    q[URLDecoder.decode(it.substringBefore('='), "UTF-8")] = URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
                }
                val out = sock.getOutputStream()
                if (q["k"] != (prefs().getString("code", "") ?: "")) { reply(out, 403, "application/json", "{\"error\":\"code\"}".toByteArray()); return }
                lastCar = System.currentTimeMillis()
                when (path) {
                    "/ping" -> json(out, JSONObject().put("ok", true).put("spotify", spotifyOk()).put("error", spotifyError ?: ""))
                    "/browse" -> json(out, browse(q["key"] ?: "root", (q["offset"] ?: "0").toIntOrNull() ?: 0, q["item"] ?: ""))
                    "/play" -> json(out, play(q["item"] ?: "", q["ctx"] ?: "", (q["index"] ?: "").toIntOrNull() ?: -1))
                    "/next" -> json(out, skip(true))
                    "/prev" -> json(out, skip(false))
                    "/img" -> {
                        val b = picture(q["key"] ?: "")
                        if (b == null) reply(out, 404, "text/plain", "no picture".toByteArray()) else reply(out, 200, "image/jpeg", b)
                    }
                    else -> reply(out, 404, "text/plain", "?".toByteArray())
                }
            } catch (e: Exception) { }
        }
    }

    private fun reply(out: OutputStream, code: Int, type: String, body: ByteArray) {
        val head = "HTTP/1.1 $code OK\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.UTF_8))
        out.write(body)
        out.flush()
    }

    private fun json(out: OutputStream, j: JSONObject) = reply(out, 200, "application/json; charset=utf-8", j.toString().toByteArray(Charsets.UTF_8))

    private fun toItem(j: JSONObject) = ListItem(
        j.optString("id"), j.optString("uri"), ImageUri(j.optString("img")),
        j.optString("title"), j.optString("subtitle"), j.optBoolean("playable"), j.optBoolean("hasChildren"),
    )

    /** Waits (up to 10 s) for a Spotify call made on the main thread: start(ok, fail) starts it. */
    private fun <T> await(start: (ok: (T) -> Unit, fail: (Throwable) -> Unit) -> Unit): Pair<T?, String?> {
        val got = AtomicReference<T?>(null)
        val err = AtomicReference<String?>(null)
        val latch = CountDownLatch(1)
        main.post {
            try { start({ got.set(it); latch.countDown() }, { err.set(it.message ?: it.javaClass.simpleName); latch.countDown() }) }
            catch (e: Exception) { err.set(e.message ?: e.javaClass.simpleName); latch.countDown() }
        }
        if (!latch.await(10, TimeUnit.SECONDS)) return Pair(null, "Spotify did not answer")
        return Pair(got.get(), err.get())
    }

    private fun browse(key: String, offset: Int, itemJson: String): JSONObject {
        val res = JSONObject().put("key", key).put("offset", offset)
        val r = remote
        if (r == null || !r.isConnected) return res.put("items", JSONArray()).put("error", "Spotify not connected on the phone" + (spotifyError?.let { " ($it)" } ?: ""))
        val item = if (itemJson.isEmpty()) null else toItem(JSONObject(itemJson))
        val (items, e) = await<ListItems> { ok, fail ->
            val call = if (item == null) r.contentApi.getRecommendedContentItems(ContentApi.ContentType.DEFAULT)
            else r.contentApi.getChildrenOfItem(item, 50, offset)
            call.setResultCallback { ok(it) }.setErrorCallback { fail(it) }
        }
        if (items == null) return res.put("items", JSONArray()).put("error", e ?: "error")
        val arr = JSONArray()
        for (it in items.items) {
            arr.put(JSONObject()
                .put("id", it.id).put("uri", it.uri)
                .put("title", it.title ?: "").put("subtitle", it.subtitle ?: "")
                .put("img", it.imageUri?.raw ?: "")
                .put("playable", it.playable).put("hasChildren", it.hasChildren))
        }
        return res.put("total", items.total).put("items", arr)
    }

    /** Plays an item; with ctx (its list's uri) and index, the song at that place of the list, so next / previous follow the list. */
    private fun play(itemJson: String, ctx: String, index: Int): JSONObject {
        val r = remote
        if (r == null || !r.isConnected || itemJson.isEmpty()) return JSONObject().put("ok", false)
        val li = toItem(JSONObject(itemJson))
        main.post {
            if (ctx.isNotEmpty() && index >= 0) {
                r.playerApi.skipToIndex(ctx, index).setErrorCallback {
                    // the list could not be played from there: the song alone
                    if (li.playable) r.contentApi.playContentItem(li) else r.playerApi.play(li.uri)
                }
            } else if (li.playable) r.contentApi.playContentItem(li) else r.playerApi.play(li.uri)
        }
        return JSONObject().put("ok", true)
    }

    /** Next (true) or previous song, in Spotify itself. */
    private fun skip(next: Boolean): JSONObject {
        val r = remote
        if (r == null || !r.isConnected) return JSONObject().put("ok", false)
        main.post { if (next) r.playerApi.skipNext() else r.playerApi.skipPrevious() }
        return JSONObject().put("ok", true)
    }

    /** A row's picture: Spotify's thumbnail, made 96 px, as JPEG. */
    private fun picture(raw: String): ByteArray? {
        val r = remote ?: return null
        if (raw.isEmpty() || !r.isConnected) return null
        val (bmp, _) = await<Bitmap> { ok, fail ->
            r.imagesApi.getImage(ImageUri(raw), Image.Dimension.THUMBNAIL).setResultCallback { ok(it) }.setErrorCallback { fail(it) }
        }
        if (bmp == null) return null
        val s = Bitmap.createScaledBitmap(bmp, 96, 96, true)
        val o = ByteArrayOutputStream()
        s.compress(Bitmap.CompressFormat.JPEG, 80, o)
        return o.toByteArray()
    }
}
