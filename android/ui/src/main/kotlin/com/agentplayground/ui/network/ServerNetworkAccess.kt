package com.agentplayground.ui.network

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.agentplayground.core.network.normalizeServerUrl
import java.net.InetAddress
import java.net.URI
import java.net.UnknownHostException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ServerNetworkAccess(
    private val sdkInt: Int,
    private val isGranted: () -> Boolean,
    private val requestPermission: suspend () -> Boolean,
    private val resolveHost: suspend (String) -> List<InetAddress> = { host ->
        withContext(Dispatchers.IO) { InetAddress.getAllByName(host).toList() }
    },
) {
    suspend fun isAllowed(serverUrl: String): Boolean {
        if (sdkInt < 37 || isGranted()) {
            return true
        }

        val host = URI(normalizeServerUrl(serverUrl)).host.removeSuffix(".")

        if (host == "localhost" || host.endsWith(".localhost")) {
            return true
        }

        // Resolving mDNS names itself requires local-network access.
        if (host.endsWith(".local")) {
            return false
        }

        val addresses =
            try {
                resolveHost(host)
            } catch (_: UnknownHostException) {
                // Let the normal connection check report DNS failures.
                return true
            }

        return addresses.none { address ->
            val bytes = address.address
            val sharedIpv4 =
                bytes.size == 4 &&
                    (bytes[0].toInt() and 0xff) == 100 &&
                    (bytes[1].toInt() and 0xc0) == 64
            val uniqueLocalIpv6 = bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc

            !address.isLoopbackAddress &&
                (address.isSiteLocalAddress ||
                    address.isLinkLocalAddress ||
                    sharedIpv4 ||
                    uniqueLocalIpv6)
        }
    }

    suspend fun request(serverUrl: String): Boolean {
        if (isAllowed(serverUrl)) {
            return true
        }

        return requestPermission()
    }
}

private class PendingPermission {
    var result: CompletableDeferred<Boolean>? = null
}

@Composable
fun rememberServerNetworkAccess(): ServerNetworkAccess {
    val context = LocalContext.current
    val pending = remember { PendingPermission() }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pending.result?.complete(granted)
            pending.result = null
        }

    val access =
        remember(context, launcher) {
            ServerNetworkAccess(
                sdkInt = Build.VERSION.SDK_INT,
                isGranted = {
                    Build.VERSION.SDK_INT < 37 ||
                        ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_LOCAL_NETWORK,
                        ) == PackageManager.PERMISSION_GRANTED
                },
                requestPermission = {
                    if (Build.VERSION.SDK_INT < 37) {
                        true
                    } else {
                        // A cancelled caller leaves the system dialog outstanding. Share its
                        // result with the next caller instead of launching a second dialog.
                        val result =
                            pending.result
                                ?: CompletableDeferred<Boolean>().also {
                                    pending.result = it
                                    launcher.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
                                }

                        result.await()
                    }
                },
            )
        }

    DisposableEffect(access) {
        onDispose {
            pending.result?.cancel()
            pending.result = null
        }
    }

    return access
}
