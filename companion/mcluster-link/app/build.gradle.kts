plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "gr.mcluster.link"
    compileSdk = 34
    defaultConfig {
        applicationId = "gr.mcluster.link"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + versionCode
    }
    // one fixed key, so its fingerprint (registered with Spotify) stays the same from build to build
    signingConfigs {
        create("link") {
            storeFile = file("../mcluster-link.jks")
            storePassword = "mclusterlink"
            keyAlias = "link"
            keyPassword = "mclusterlink"
        }
    }
    buildTypes {
        release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("link") }
        debug { signingConfig = signingConfigs.getByName("link") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Spotify's App Remote SDK (fetched by the build from github.com/spotify/android-sdk) and what it needs
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar"))))
    implementation("com.google.code.gson:gson:2.10.1")
}
