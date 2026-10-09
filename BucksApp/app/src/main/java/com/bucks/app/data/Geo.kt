package com.bucks.app.data

import kotlin.math.*

data class LatLng(val lat: Double, val lng: Double)

/** Bengaluru viewport used to project real coordinates onto the drawn map (0–100 %). */
object Geo {
    val CENTER = LatLng(12.9250, 77.5938)         // Jayanagar
    private const val SPAN_LAT = 0.09; private const val SPAN_LNG = 0.11
    fun toPercent(p: LatLng): Pair<Float, Float> = Pair((((p.lng - (CENTER.lng - SPAN_LNG / 2)) / SPAN_LNG) * 100).toFloat().coerceIn(2f, 98f), (((CENTER.lat + SPAN_LAT / 2 - p.lat) / SPAN_LAT) * 100).toFloat().coerceIn(2f, 98f))
    fun fromPercent(x: Float, y: Float) = LatLng(CENTER.lat + SPAN_LAT / 2 - y / 100.0 * SPAN_LAT, CENTER.lng - SPAN_LNG / 2 + x / 100.0 * SPAN_LNG)
    fun distanceKm(a: LatLng, b: LatLng): Double { val r = 6371.0; val dLat = Math.toRadians(b.lat - a.lat); val dLng = Math.toRadians(b.lng - a.lng)
        val h = sin(dLat / 2).pow(2) + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLng / 2).pow(2); return 2 * r * asin(sqrt(h)) }
    /** Coarse grid cell (~1.1 km) used to pre-filter the ring broadcast; swap for H3 on the server. */
    fun cell(p: LatLng): String = "${(p.lat * 100).roundToInt()}:${(p.lng * 100).roundToInt()}"
    fun neighbours(p: LatLng, rings: Int = 4): Set<String> { val la = (p.lat * 100).roundToInt(); val ln = (p.lng * 100).roundToInt(); val s = HashSet<String>(); for (i in -rings..rings) for (j in -rings..rings) s.add("${la + i}:${ln + j}"); return s }
    /** Everyone online within the ring radius, nearest first — a published rule, not a model. */
    fun ring(from: LatLng, drivers: List<Driver>, kind: VehicleKind, radiusKm: Double = 5.0): List<Driver> {
        val cells = neighbours(from); return drivers.filter { it.online && it.vehicle == kind && cell(it.pos) in cells && distanceKm(from, it.pos) <= radiusKm }.sortedBy { distanceKm(from, it.pos) }
    }
    val PLACES: Map<String, LatLng> = mapOf("Koramangala, Bengaluru" to LatLng(12.9352, 77.6245), "Nexus Mall, Koramangala" to LatLng(12.9345, 77.6113), "Jayanagar 4th block" to LatLng(12.9279, 77.5836), "MG Road" to LatLng(12.9757, 77.6063), "Indiranagar 100 ft Rd" to LatLng(12.9784, 77.6408), "Whitefield, ITPL" to LatLng(12.9855, 77.7363), "Majestic bus stand" to LatLng(12.9774, 77.5713), "Kempegowda airport" to LatLng(13.1989, 77.7068))
}
