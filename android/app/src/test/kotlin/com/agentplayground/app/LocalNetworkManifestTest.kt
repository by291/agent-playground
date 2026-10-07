package com.agentplayground.app

import android.content.pm.PackageManager
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LocalNetworkManifestTest {
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
}
