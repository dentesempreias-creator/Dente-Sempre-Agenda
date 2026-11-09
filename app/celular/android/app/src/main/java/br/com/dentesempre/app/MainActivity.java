package br.com.dentesempre.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Tela do celular (09/11): o tamanho de fonte escolhido no Android não aumenta mais o texto do app.
    // Com a fonte do sistema grande, o texto saía das caixas (ex.: "Sincronizado" maior que o botão).
    // O app já usa letras e botões grandes no celular.
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) webView.getSettings().setTextZoom(100);
    }
}
