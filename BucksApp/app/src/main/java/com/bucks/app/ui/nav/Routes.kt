package com.bucks.app.ui.nav

object Routes {
    const val SPLASH = "splash"; const val LOGIN = "login"; const val OTP = "otp"; const val SIGNUP_EMAIL = "signupEmail"; const val PROFILE = "profile"
    const val HOME = "home"; const val FEED = "feed"; const val SERVICES = "services"; const val RECOMMENDED = "recommended"; const val ACCOUNT = "account"; const val ACTIVITY = "account?tab=activity"
    const val SEARCH = "search"; const val PROVIDER = "provider/{id}"; const val CART = "cart"; const val ORDER = "order/{id}"; const val REQUEST = "request/{id}"; const val REQUEST_STATUS = "requestStatus/{id}"
    const val DESTINATION = "destination"; const val CHOOSE_RIDE = "chooseRide"; const val SEARCHING = "searching"; const val DRIVER_FOUND = "driverFound"; const val IN_RIDE = "inRide"; const val PAY = "pay"; const val RATE_RIDE = "rateRide"
    const val PRO_CREATE = "proCreate"; const val LISTINGS = "listings"; const val EARNINGS = "earnings"
    const val MESSAGES = "messages"; const val CHAT = "chat/{id}"
    fun provider(id: String, tab: String = "about") = "provider/$id?tab=$tab"
    fun order(id: String) = "order/$id"
    fun request(id: String) = "request/$id"
    fun requestStatus(id: String) = "requestStatus/$id"
    fun chat(id: String) = "chat/$id"
}
