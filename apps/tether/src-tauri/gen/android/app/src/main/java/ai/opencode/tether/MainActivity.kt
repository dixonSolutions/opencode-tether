package ai.opencode.tether

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.ScriptHandler
import org.json.JSONObject
import java.lang.reflect.Proxy
import java.io.File
import java.io.InputStream
import java.util.zip.ZipInputStream
import android.util.Log

class MainActivity : TauriActivity() {
  private external fun nativeSetWebRoot(root: String): Boolean
  private var liveCallback: Any? = null
  private var liveAppliedVersion: String? = null
  private var liveReadyNonce: String? = null
  private var trialScript: ScriptHandler? = null
  private var liveHandler: Any? = null
  private var activeSlot: File? = null
  private var pendingRoot: File? = null
  private var previousRoot: File? = null
  private var webRoot: File? = null
  private var appWebView: WebView? = null
  private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()

  /** Extract only trusted, signed slot content. Reject traversal and decompression bombs. */
  private fun unpackWeb(input: InputStream): File {
    val root = File(cacheDir, "tether-web-${java.util.UUID.randomUUID()}")
    root.mkdirs()
    try {
      var total = 0L
      ZipInputStream(input).use { zip ->
        while (true) {
          val entry = zip.nextEntry ?: break
          val file = File(root, entry.name).canonicalFile
          require(file.path.startsWith(root.canonicalPath + File.separator))
          if (!entry.isDirectory) {
            file.parentFile?.mkdirs()
            file.outputStream().use { output ->
              val buffer = ByteArray(8192)
              while (true) {
                val count = zip.read(buffer)
                if (count < 0) break
                total += count
                require(total <= 32L * 1024 * 1024) { "Web content exceeds limit" }
                output.write(buffer, 0, count)
              }
            }
          }
        }
      }
      require(File(root, "index.html").isFile)
      return root
    } catch (error: Throwable) { root.deleteRecursively(); throw error }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    System.loadLibrary("opencode_tether_lib")
    // ResourcesLoader resolves this to the current AndySU slot, or the plain APK.
    cacheDir.listFiles()?.filter { it.name.startsWith("tether-web-") }?.forEach { it.deleteRecursively() }
    try {
      webRoot = unpackWeb(assets.open("tether-web.zip"))
      check(nativeSetWebRoot(webRoot!!.path))
    } catch (error: java.io.FileNotFoundException) {
      // `tauri android dev` serves Vite directly and does not package an archive.
      if (!BuildConfig.DEBUG) throw error
      Log.i("TetherUpdate", "No packaged web content; using development server")
    }
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    appWebView = webView
    installAndyBridge(webView)
    installLiveHandler(webView)
  }

  private fun installLiveHandler(webView: WebView) {
    try {
      val api = Class.forName("com.andysu.api.HostApi")
      val host = Class.forName("com.andysu.api.Host").getMethod("current").invoke(null) ?: return
      activeSlot = api.getMethod("slotDir").invoke(host) as File
      val handlerClass = Class.forName("com.andysu.api.LiveSwapHandler")
      val handler = Proxy.newProxyInstance(handlerClass.classLoader, arrayOf(handlerClass)) { _, method, args ->
        if (method.name != "onLiveSwap") return@newProxyInstance null
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return@newProxyInstance false
        val slot = args!![0] as File
        // JNI registrations, Tao's event loop and Rust's global app cannot be unloaded safely.
        // Accept only web-only releases with byte-identical native code.
        // The host verifies these immutable component digests before offering the slot.
        // Comparing the small signed index avoids hashing megabytes on the input thread.
        fun codeAndResources(dir: File): Map<String, String> {
          val index = File(dir, ".andysu-slot.json").takeIf { it.isFile } ?: File(dir, "andysu-slot.json")
          val components = JSONObject(index.readText()).getJSONArray("components")
          return (0 until components.length()).map { components.getJSONObject(it) }
            .filter { it.getString("path") !in setOf("andysu-payload.json", "assets/tether-web.zip") }
            .associate { it.getString("path") to it.getString("sha256") }
        }
        val old = activeSlot ?: return@newProxyInstance false
        val before = codeAndResources(old)
        if (before.isEmpty() || before != codeAndResources(slot) || !File(slot, "assets/tether-web.zip").isFile) {
          Log.i("TetherUpdate", "native change: automatic restart fallback")
          return@newProxyInstance false
        }
        liveCallback = args[2]
        worker.execute {
          try {
            val root = unpackWeb(File(slot, "assets/tether-web.zip").inputStream())
            pendingRoot = root
            webView.post {
              webView.evaluateJavascript("window.dispatchEvent(new Event('andysu-before-apply'))", null)
            }
          } catch (error: Throwable) {
            webView.post { failLive(error.message ?: "Invalid web content") }
          }
        }
        true
      }
      liveHandler = handler
      api.getMethod("setLiveSwapHandler", handlerClass).invoke(host, handler)
      // Migrate installs whose older payload persisted next_start.
      val updates = api.getMethod("updates").invoke(host)
      worker.execute { Class.forName("com.andysu.api.UpdateClient").getMethod("setApplyPolicy", String::class.java).invoke(updates, "live") }
    } catch (_: ClassNotFoundException) { /* Plain APK. */ }
  }

  private fun failLive(reason: String) {
    trialScript?.remove(); trialScript = null; liveReadyNonce = null
    previousRoot?.let { nativeSetWebRoot(it.path); webRoot = it }
    pendingRoot?.deleteRecursively(); pendingRoot = null
    liveCallback?.let { Class.forName("com.andysu.api.LiveSwapCallback").getMethod("failed", String::class.java).invoke(it, reason) }
    liveCallback = null
  }

  private fun reloadWeb() {
    val root = pendingRoot ?: return
    previousRoot = webRoot
    if (!nativeSetWebRoot(root.path)) { failLive("Could not load web assets"); return }
    webRoot = root
    val view = appWebView ?: return
    try {
      val nonce = java.util.UUID.randomUUID().toString()
      liveReadyNonce = nonce
      trialScript = WebViewCompat.addDocumentStartJavaScript(
        view, "window.__TETHER_UPDATE_TRIAL__ = " + JSONObject.quote(nonce) + ";", setOf("http://tauri.localhost")
      )
      view.clearCache(true)
      view.reload()
    } catch (error: Throwable) { failLive(error.message ?: "Could not reload web content") }
  }

  private fun webReady(nonce: String) {
    // Only the new document knows the nonce. An old page reconnect cannot commit this trial.
    if (liveReadyNonce == null || nonce != liveReadyNonce) {
      if (liveCallback != null) Log.i("TetherUpdate", "ignored stale document ready acknowledgement")
      return
    }
    trialScript?.remove(); trialScript = null; liveReadyNonce = null
    val cb = liveCallback ?: return
    liveCallback = null
    Class.forName("com.andysu.api.LiveSwapCallback").getMethod("started").invoke(cb)
    val api = Class.forName("com.andysu.api.HostApi")
    val host = Class.forName("com.andysu.api.Host").getMethod("current").invoke(null)
    liveAppliedVersion = api.getMethod("version").invoke(host) as String
    api.getMethod("markHealthy").invoke(host)
    activeSlot = api.getMethod("slotDir").invoke(host) as File
    Log.i("TetherUpdate", "update applied live version=" + api.getMethod("version").invoke(host) + " pid=" + android.os.Process.myPid())
    previousRoot?.deleteRecursively(); previousRoot = null; pendingRoot = null
  }

  /**
   * The AndySU update host, when this build runs under one. Everything goes through
   * reflection, so a plain build (no `com.andysu.api` classes) simply reports unavailable.
   */
  inner class AndyBridge(private val webView: WebView) {
    @Volatile private var restoreOffAfterCheck = false
    private fun host(): Any? = try {
      Class.forName("com.andysu.api.Host").getMethod("current").invoke(null)
    } catch (_: Throwable) { null }
    private fun api() = Class.forName("com.andysu.api.HostApi")
    private fun updates(): Any? = host()?.let { api().getMethod("updates").invoke(it) }
    private fun updateApi() = Class.forName("com.andysu.api.UpdateClient")
    private fun call(name: String): Any? = updates()?.let { updateApi().getMethod(name).invoke(it) }

    fun available(): Boolean = host() != null
    fun status(): String {
      return try {
        val h = host() ?: return "{}"
        JSONObject(call("status") as String).put("runningVersion", api().getMethod("version").invoke(h)).put("liveAppliedVersion", liveAppliedVersion).toString()
      } catch (_: Throwable) { "{}" }
    }
    fun mode(): String = try { call("mode") as? String ?: "auto" } catch (_: Throwable) { "auto" }
    fun setMode(mode: String) {
      restoreOffAfterCheck = false
      if (mode != "auto" && mode != "off") return
      try { updates()?.let { updateApi().getMethod("setMode", String::class.java).invoke(it, mode) } } catch (_: Throwable) { }
    }
    fun checkNow() {
      try {
        // A manual check must still work when automatic updates are disabled.
        // download_only prevents this one check from automatically applying anything.
        if (mode() == "off") {
          updates()?.let { updateApi().getMethod("setMode", String::class.java).invoke(it, "download_only") }
          restoreOffAfterCheck = true
        }
        call("checkNow")
      } catch (_: Throwable) { }
    }
    fun applyNow() {
      try {
        if (JSONObject(status()).optString("state") == "shell_update" && !packageManager.canRequestPackageInstalls()) {
          // Replacing the host needs the per-app "install unknown apps" grant.
          runOnUiThread {
            startActivity(
              Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          }
        } else { call("applyNow") }
      } catch (_: Throwable) { }
    }
    fun listen(reply: JavaScriptReplyProxy) {
      try {
        val listener = Class.forName("com.andysu.api.UpdateClient\$Listener")
        val proxy = Proxy.newProxyInstance(listener.classLoader, arrayOf(listener)) { _, method, _ ->
          if (method.name == "onStatus") {
            val json = status()
            if (restoreOffAfterCheck && JSONObject(json).optString("state") in setOf("staged", "up_to_date", "available", "shell_update", "error", "deferred")) {
              restoreOffAfterCheck = false
              worker.execute { updates()?.let { updateApi().getMethod("setMode", String::class.java).invoke(it, "off") } }
            }
            webView.post { reply.postMessage(JSONObject().put("type", "status").put("status", JSONObject(json)).toString()) }
          }
          null
        }
        updates()?.let { updateApi().getMethod("setListener", listener).invoke(it, proxy) }
      } catch (_: Throwable) { }
    }
  }

  /**
   * `window.AndySU` for the Updates tab. Only the app's own origin and only the main frame may
   * use it, so embedded third-party content cannot reach the updater.
   */
  private fun installAndyBridge(webView: WebView) {
    val bridge = AndyBridge(webView)
    if (!bridge.available() || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    WebViewCompat.addWebMessageListener(webView, "AndySU", setOf("http://tauri.localhost")) { _, message, sourceOrigin, isMainFrame, reply ->
      if (!isMainFrame || sourceOrigin.toString() != "http://tauri.localhost") return@addWebMessageListener
      val request = try { JSONObject(message.data ?: return@addWebMessageListener) } catch (_: Exception) { return@addWebMessageListener }
      when (request.optString("action")) {
        "init" -> {
          bridge.listen(reply)
          reply.postMessage(
            JSONObject().put("type", "init").put("sdk", Build.VERSION.SDK_INT)
              .put("mode", bridge.mode()).put("status", JSONObject(bridge.status())).toString()
          )
        }
        "abortWeb" -> failLive("Could not save application state")
        "reloadWeb" -> reloadWeb()
        "webReady" -> webReady(request.optString("token"))
        "status" -> reply.postMessage(JSONObject().put("type", "status").put("status", JSONObject(bridge.status())).toString())
        "setMode" -> worker.execute { bridge.setMode(request.optString("mode")) }
        "checkNow" -> worker.execute { bridge.checkNow() }
        "applyNow" -> bridge.applyNow()
      }
    }
  }
}
