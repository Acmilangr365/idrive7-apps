package gr.mcluster.link

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote

/**
 * The settings: the Spotify Client ID (from developer.spotify.com) and the code the iDrive shows. Start: Spotify asks
 * once for permission here, then the link runs in the background; the car finds it over this phone's hotspot.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private val h = Handler(Looper.getMainLooper())

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val p = getSharedPreferences("link", MODE_PRIVATE)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        fun label(t: String) = TextView(this).apply { text = t; textSize = 14f; setPadding(0, pad, 0, 0) }
        fun field(key: String, hint: String, num: Boolean) = EditText(this).apply {
            setText(p.getString(key, ""))
            this.hint = hint
            isSingleLine = true
            inputType = if (num) InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        val title = TextView(this).apply { text = "M Cluster Link"; textSize = 24f }
        val cid = field("clientId", "Spotify Client ID", false)
        val code = field("code", "4 digits", true)
        val help = TextView(this).apply { textSize = 14f; setPadding(0, pad, 0, 0); text = "Turn this phone's hotspot on and join the iDrive to it once (it reconnects by itself). The car finds this app on its own." }
        status = TextView(this).apply { textSize = 15f; setPadding(0, pad, 0, 0) }
        val start = Button(this).apply { text = "Start" }
        val stop = Button(this).apply { text = "Stop" }
        start.setOnClickListener {
            p.edit()
                .putString("clientId", cid.text.toString().trim())
                .putString("code", code.text.toString().trim())
                .apply()
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            }
            authorise(cid.text.toString().trim())
            startForegroundService(Intent(this, LinkService::class.java))
        }
        stop.setOnClickListener { stopService(Intent(this, LinkService::class.java)) }
        listOf(
            title,
            label("Spotify Client ID"), cid,
            label("Code shown on the iDrive"), code,
            help, start, stop, status,
        ).forEach { col.addView(it) }
        setContentView(ScrollView(this).apply { addView(col) })
        tick()
    }

    /** Spotify's one-time permission screen needs an activity: connect once from here, then let the service go on. */
    private fun authorise(id: String) {
        if (id.isEmpty()) return
        val params = ConnectionParams.Builder(id).setRedirectUri(LinkService.REDIRECT).showAuthView(true).build()
        SpotifyAppRemote.connect(this, params, object : Connector.ConnectionListener {
            override fun onConnected(r: SpotifyAppRemote) {
                SpotifyAppRemote.disconnect(r)
                LinkService.spotifyError = null
            }

            override fun onFailure(t: Throwable) {
                LinkService.spotifyError = t.javaClass.simpleName + ": " + (t.message ?: "")
            }
        })
    }

    private fun tick() {
        status.text = LinkService.status + (LinkService.spotifyError?.let { "\n\nSpotify: $it" } ?: "")
        h.postDelayed({ tick() }, 1000)
    }

    override fun onDestroy() {
        h.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
