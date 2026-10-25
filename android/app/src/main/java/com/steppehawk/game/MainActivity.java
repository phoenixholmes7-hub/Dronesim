package com.steppehawk.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.util.Consumer;
import androidx.webkit.WebViewAssetLoader;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;

import java.util.Locale;

/**
 * Hosts the web game full screen. The game is served from the APK's assets through
 * WebViewAssetLoader (a secure https origin, no network needed). Fold state from Jetpack
 * WindowManager is pushed to the page so it can split the screen in tabletop/book posture.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";

    private WebView web;
    private WindowInfoTrackerCallbackAdapter windowTracker;
    private final Consumer<WindowLayoutInfo> layoutListener = this::onWindowLayout;
    private String foldJson = "null";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(5, 8, 10));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushFold();
            }
        });
        web.addJavascriptInterface(new Bridge(), "SteppeHawkNative");
        setContentView(web);
        hideSystemBars();

        windowTracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(this));
        web.loadUrl(START_URL);
    }

    @Override
    protected void onStart() {
        super.onStart();
        windowTracker.addWindowLayoutInfoListener(this, this::runOnUiThread, layoutListener);
    }

    @Override
    protected void onStop() {
        windowTracker.removeWindowLayoutInfoListener(layoutListener);
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @SuppressLint("MissingSuperCall")
    @Override
    public void onBackPressed() {
        // Let the game handle back (pause / resume / leave a screen); quit only from the main menu.
        web.evaluateJavascript("window.__nativeBack ? window.__nativeBack() : false", value -> {
            if (!"true".equals(value)) finish();
        });
    }

    private void onWindowLayout(WindowLayoutInfo info) {
        FoldingFeature fold = null;
        for (DisplayFeature f : info.getDisplayFeatures()) {
            if (f instanceof FoldingFeature) fold = (FoldingFeature) f;
        }
        if (fold == null) {
            foldJson = "null";
        } else {
            Rect r = fold.getBounds();
            int[] loc = new int[2];
            web.getLocationInWindow(loc);
            float d = getResources().getDisplayMetrics().density;
            foldJson = String.format(Locale.US,
                    "{\"state\":\"%s\",\"orientation\":\"%s\",\"separating\":%b,\"x\":%.1f,\"y\":%.1f,\"w\":%.1f,\"h\":%.1f}",
                    fold.getState() == FoldingFeature.State.HALF_OPENED ? "HALF_OPENED" : "FLAT",
                    fold.getOrientation() == FoldingFeature.Orientation.HORIZONTAL ? "HORIZONTAL" : "VERTICAL",
                    fold.isSeparating(),
                    (r.left - loc[0]) / d, (r.top - loc[1]) / d, r.width() / d, r.height() / d);
        }
        pushFold();
    }

    private void pushFold() {
        if (web != null) web.evaluateJavascript("window.__setFold && window.__setFold(" + foldJson + ")", null);
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    /** Exposed to the page as window.SteppeHawkNative (its presence tells the game it runs in the app). */
    private static final class Bridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }
    }
}
