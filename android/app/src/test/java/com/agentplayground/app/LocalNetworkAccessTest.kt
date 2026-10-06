package com.agentplayground.app

import android.content.pm.PackageManager
import com.agentplayground.app.network.ServerNetworkAccess
import java.net.InetAddress
import java.net.UnknownHostException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LocalNetworkAccessTest {
    @Test
    fun `app declares the permission needed by its default emulator connection`() {
        val application = RuntimeEnvironment.getApplication()
        val permissions =
            application.packageManager
                .getPackageInfo(application.packageName, PackageManager.GET_PERMISSIONS)
                .requestedPermissions
                .orEmpty()

        assertTrue(permissions.contains("android.permission.ACCESS_LOCAL_NETWORK"))
    }

    @Test
    fun `default emulator server requires a runtime grant on Android 17`() = runBlocking {
        var requests = 0
        val access =
            ServerNetworkAccess(
                sdkInt = 37,
                isGranted = { false },
                requestPermission = {
                    requests++
                    false
                },
            )

        assertFalse(access.request("http://10.0.2.2:3000/"))
        assertEquals(1, requests)
    }

    @Test
    fun `existing grants and older Android versions do not prompt or resolve hosts`() =
        runBlocking {
            listOf(36 to false, 37 to true).forEach { (sdk, granted) ->
                val access =
                    ServerNetworkAccess(
                        sdkInt = sdk,
                        isGranted = { granted },
                        requestPermission = { error("Permission is already available") },
                        resolveHost = { error("No address lookup is needed") },
                    )

                assertTrue(access.request("http://10.0.2.2:3000/"))
            }
        }

    @Test
    fun `internet servers and adb reverse remain usable without a local network grant`() =
        runBlocking {
            val access =
                ServerNetworkAccess(
                    sdkInt = 37,
                    isGranted = { false },
                    requestPermission = { error("This connection needs no local network access") },
                )

            listOf("127.0.0.1", "[::1]", "localhost").forEach { host ->
                assertTrue(access.request("http://$host:3000/"))
            }

            listOf("203.0.113.1", "100.63.255.255", "100.128.0.0").forEach { address ->
                val internet =
                    ServerNetworkAccess(
                        sdkInt = 37,
                        isGranted = { false },
                        requestPermission = { error("This server is on the internet") },
                        resolveHost = { listOf(InetAddress.getByName(address)) },
                    )

                assertTrue(internet.request("https://server.example/"))
            }
        }

    @Test
    fun `LAN names and IPv6 local addresses require permission`() = runBlocking {
        listOf(
                "192.168.1.8",
                "172.16.1.8",
                "169.254.1.8",
                "100.64.0.1",
                "100.127.255.254",
                "fd00::1",
                "fe80::1",
            )
            .forEach { address ->
                val access =
                    ServerNetworkAccess(
                        sdkInt = 37,
                        isGranted = { false },
                        requestPermission = { true },
                        resolveHost = { listOf(InetAddress.getByName(address)) },
                    )

                assertFalse(access.isAllowed("https://playground.example/"))
                assertTrue(access.request("https://playground.example/"))
            }
    }

    @Test
    fun `mDNS permission is requested before name resolution`() = runBlocking {
        val access =
            ServerNetworkAccess(
                sdkInt = 37,
                isGranted = { false },
                requestPermission = { false },
                resolveHost = { error("mDNS resolution also needs permission") },
            )

        assertFalse(access.request("http://playground.local:3000/"))
    }

    @Test
    fun `DNS errors are left for the connection check`() = runBlocking {
        val access =
            ServerNetworkAccess(
                sdkInt = 37,
                isGranted = { false },
                requestPermission = { error("DNS failure is not a permission failure") },
                resolveHost = { throw UnknownHostException(it) },
            )

        assertTrue(access.request("https://missing.example/"))
    }
}
