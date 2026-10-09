package com.bucks.app

import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.bucks.app.ui.BucksAppUi
import com.bucks.app.ui.BucksViewModel

class MainActivity : FragmentActivity() {
    private val vm: BucksViewModel by viewModels { BucksViewModel.Factory((application as BucksApp).repository) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { BucksAppUi(vm) }
    }
}
