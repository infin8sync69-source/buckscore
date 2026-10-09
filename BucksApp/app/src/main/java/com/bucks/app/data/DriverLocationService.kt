package com.bucks.app.data

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Foreground service (type=location) that streams the driver's position while they are on duty.
 * Required by Play policy for continuous location; declared in the manifest. Positions go to
 * [DriverLocationService.position]; the repository/backend consumes them.
 */
class DriverLocationService : Service() {
    private lateinit var client: FusedLocationProviderClient
    private val callback = object : LocationCallback() { override fun onLocationResult(r: LocationResult) { r.lastLocation?.let { position.value = LatLng(it.latitude, it.longitude); mocked.value = (Build.VERSION.SDK_INT >= 31 && it.isMock) } } }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); client = LocationServices.getFusedLocationProviderClient(this) }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "On duty", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, packageManager.getLaunchIntentForPackage(packageName), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL).setContentTitle("You're online on Bucks").setContentText("Sharing your location so nearby customers can ring you").setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).setContentIntent(open).build()
        val ok = runCatching { if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(1, n) }.isSuccess
        if (!ok) { stopSelf(); return START_NOT_STICKY }
        try { client.requestLocationUpdates(LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000L).setMinUpdateDistanceMeters(15f).build(), callback, Looper.getMainLooper()) } catch (_: SecurityException) { stopSelf() }
        return START_STICKY
    }
    override fun onDestroy() { client.removeLocationUpdates(callback); super.onDestroy() }
    companion object {
        const val CHANNEL = "bucks_on_duty"
        val position = MutableStateFlow<LatLng?>(null)
        val mocked = MutableStateFlow(false)
        fun start(ctx: Context) { val i = Intent(ctx, DriverLocationService::class.java); if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i) }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, DriverLocationService::class.java)) }
    }
}
