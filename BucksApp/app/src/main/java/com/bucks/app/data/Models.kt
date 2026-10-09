package com.bucks.app.data

enum class ProviderType { BUSINESS, SKILL }
enum class Scope { LOCAL, GLOBAL }
enum class VehicleKind(val wheels: String, val label: String, val farePerKm: Int) {
    BIKE("2", "Bike", 8), AUTO("3", "Auto", 12), CAB("4", "Cab", 18)
}

data class Trust(val up: Int, val down: Int) {
    val total get() = up + down
    val pct: Int? get() = if (total == 0) null else (up * 100) / total
}

/** A vote is a signed record tied to a completed transaction; the comment is public. */
data class Comment(val who: String, val text: String, val vote: Int, val voterId: String = "", val verified: Boolean = false, val txnId: String = "", val signature: String = "")
enum class BusinessVariant(val productsLabel: String) { RESTAURANT("Menu"), SUPERMARKET("Aisles"), FURNITURE("Catalogue"), ELECTRONICS("Products"), GENERAL("Products") }
fun variantFor(category: String): BusinessVariant = when (category.lowercase()) {
    "restaurant", "bakery" -> BusinessVariant.RESTAURANT; "grocery", "vegetables", "pharmacy" -> BusinessVariant.SUPERMARKET
    "furniture", "hardware" -> BusinessVariant.FURNITURE; "electronics", "mobile repair" -> BusinessVariant.ELECTRONICS; else -> BusinessVariant.GENERAL
}
/** tag: "Veg"/"Non-veg" for restaurants, aisle for supermarkets, material/brand for others. detail: unit, size, warranty… */
data class Item(val name: String, val price: Int, val tag: String = "", val detail: String = "", val group: String = "")

data class Provider(
    val id: String, val type: ProviderType, val category: String, val name: String,
    val tags: List<String>, val x: Float, val y: Float, val distanceKm: Double,
    val up: Int, val down: Int, val scope: Scope, val bio: String,
    val items: List<Item> = emptyList(), val rate: String? = null, val comments: List<Comment> = emptyList(),
) {
    val trust get() = Trust(up, down)
    val pos: LatLng get() = Geo.fromPercent(x, y)
    val phone: String get() = "+91 98450 ${10000 + Math.floorMod(id.hashCode(), 90000)}"
    val minPrice: Int get() = if (items.isNotEmpty()) items.minOf { it.price } else rate?.filter { it.isDigit() }?.toIntOrNull() ?: 9999
}

data class Driver(
    val id: String, val name: String, val vehicle: VehicleKind, val plate: String, val model: String,
    val x: Float, val y: Float, val distanceKm: Double, val up: Int, val down: Int, val online: Boolean,
) { val trust get() = Trust(up, down); val pos: LatLng get() = Geo.fromPercent(x, y) }

data class Post(
    val id: String, val who: String, val ago: String, val text: String,
    val hasImage: Boolean = false, val file: String? = null, val up: Int, val down: Int,
    val comments: List<Pair<String, String>> = emptyList(),
)

data class Attachment(val uri: String, val name: String, val isImage: Boolean)
data class ChatMessage(val mine: Boolean, val text: String, val attachment: Attachment? = null, val at: Long = System.currentTimeMillis())
data class Chat(val id: String, val who: String, val role: String, val messages: List<ChatMessage>, val unread: Int, val online: Boolean, val phone: String = "+91 98450 00000")

/** Someone nearby you can follow. Following only affects what you see in Discover; it never changes rankings. */
data class Person(val id: String, val name: String, val area: String, val tagline: String, val up: Int, val down: Int, val following: Boolean = false, val distanceKm: Double) { val trust get() = Trust(up, down) }
data class Community(val id: String, val name: String, val description: String, val members: Int, val joined: Boolean = false)

enum class SyncStatus { SYNCED, SYNCING, OFFLINE }
data class LinkedDevice(val id: String, val name: String, val lastSeen: String, val thisDevice: Boolean)

data class User(val name: String, val area: String, val bio: String, val phone: String, val up: Int = 0, val down: Int = 0, val email: String = "", val gender: String = "", val interests: List<String> = emptyList(), val id: String = "", val verified: Set<VerificationLevel> = emptySet()) { val trust get() = Trust(up, down) }
data class Vehicle(val kind: VehicleKind, val model: String, val plate: String)
data class ProProfile(val vehicle: Vehicle? = null, val skills: List<String> = emptyList(), val rate: String = "")
data class Business(val name: String, val category: String, val scope: Scope, val items: List<Item>)

data class Place(val name: String, val x: Float, val y: Float, val km: Double)

enum class RideStatus { SEARCHING, MATCHED, ARRIVED, IN_RIDE, COMPLETED, PAID, NO_DRIVER, CANCELLED }
data class Ride(
    val id: String, val kind: VehicleKind, val dest: Place, val fare: Int, val status: RideStatus,
    val pin: String, val driver: Driver? = null, val driverX: Float = 0f, val driverY: Float = 0f,
    val etaMin: Int = 0, val progress: Float = 0f, val paidWith: String? = null, val reason: String? = null, val signature: String = "",
)

enum class DriverRideStatus { RINGING, TO_PICKUP, ARRIVED, IN_RIDE, DONE }
data class DriverRide(
    val id: String, val status: DriverRideStatus, val customer: String, val customerTrust: Trust,
    val pickupAt: String, val dropAt: String, val km: Double, val fare: Int, val pin: String, val secondsLeft: Int, val pickupKm: Double,
)

enum class OrderStatus(val label: String) { REQUESTED("Requested"), ACCEPTED("Accepted by vendor"), PREPARING("Preparing"), OUT("Out for delivery"), DELIVERED("Delivered") }
data class Order(val id: String, val providerId: String, val providerName: String, val total: Int, val items: List<String>, val status: OrderStatus, val signature: String = "")

enum class RequestStatus(val label: String) { SENT("Sent"), ACCEPTED("Accepted"), IN_PROGRESS("In progress"), COMPLETED("Completed") }
data class ServiceRequest(val id: String, val providerId: String, val providerName: String, val category: String, val text: String, val status: RequestStatus, val signature: String = "")

/** Which voters count when a list is sorted. Pure counting over a user-chosen voter set; never a hidden model. */
enum class Lens(val label: String, val explain: String) { ALL("All verified votes", "Every vote tied to a completed transaction"), FOLLOWING("People I follow", "Only votes from accounts you follow"), VERIFIED("ID-verified voters", "Only votes from ID-verified accounts") }

/** An action the agent proposed that needs the user's explicit go-ahead before it runs. */
data class PendingAction(val title: String, val summary: String, val amount: Int, val counterparty: String, val counterpartyTrust: Trust?, val needsBiometric: Boolean, val run: () -> Unit)

data class Incoming(val who: String, val text: String)

data class AgentCard(val title: String, val detail: String, val cta: String, val action: AgentAction)
sealed interface AgentAction {
    data class OpenProvider(val id: String, val tab: String = "about") : AgentAction
    data class Request(val providerId: String) : AgentAction
}
data class AgentMessage(val mine: Boolean, val text: String, val cards: List<AgentCard> = emptyList(), val actions: List<String> = emptyList())
