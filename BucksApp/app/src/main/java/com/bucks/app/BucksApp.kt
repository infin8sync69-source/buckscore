package com.bucks.app

import android.app.Application
import com.bucks.app.data.BucksRepository
import com.bucks.app.data.FakeBucksRepository

class BucksApp : Application() {
    lateinit var repository: BucksRepository
        private set
    override fun onCreate() {
        super.onCreate()
        repository = FakeBucksRepository(this)
    }
}
