# Dente Sempre — como gerar os aplicativos

O programa é um arquivo só: `fonte/dente-sempre.html`. A partir dele geramos:

| Aplicativo | Arquivo gerado | Onde gerar |
|---|---|---|
| Windows | `Dente-Sempre-Instalador-1.0.0.exe` | Windows (ou GitHub Actions) |
| Mac | `Dente-Sempre-1.0.0-arm64.dmg` e `-x64.dmg` | Mac (ou GitHub Actions) |
| Linux | `.AppImage` e `.deb` | Linux (ou GitHub Actions) |
| Android | `app-debug.apk` (teste) / `app-release.apk` e `.aab` (assinados) | Qualquer computador com Android Studio (ou GitHub Actions) |
| iPhone | projeto do Xcode em `celular/ios` | Só num Mac com Xcode |

## 1. Antes de tudo: o endereço do servidor e a chave

Abra `config.json` e preencha:

```json
{
  "servidor": "https://agenda.minhaclinica.com.br",
  "chavePublica": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
  "ofuscar": true
}
```

- **servidor**: o endereço do servidor Dente Sempre. Precisa começar com `https://`.
- **chavePublica**: o texto que o servidor mostra como "chave pública da licença". Copie inteiro.
- **ofuscar**: `true` embaralha o código do programa (fica difícil de copiar ou alterar). Deixe `true`.

Se faltar alguma coisa, o `npm run preparar` para e explica o que falta. Ele nunca gera um aplicativo pela metade.

## 2. O que instalar (uma vez só)

- **Node.js 22**: https://nodejs.org (versão "LTS").
- **Android** (só para gerar o APK no seu computador): **Android Studio** (já vem com o JDK 21 e o Android SDK). Depois de instalar, abra o Android Studio uma vez para ele baixar o SDK.
- **iPhone**: um **Mac** com **Xcode** (App Store) e uma conta Apple Developer para publicar.

Depois, dentro da pasta `app/`:

```
npm run instalar
```

## 3. Gerar no seu computador

Sempre dentro da pasta `app/`:

| Para gerar | Comando | O arquivo fica em |
|---|---|---|
| Só testar a janela, sem instalar | `npm run desktop:abrir` | (abre o programa) |
| Windows | `npm run desktop:windows` | `desktop/dist/` |
| Mac | `npm run desktop:mac` | `desktop/dist/` |
| Linux | `npm run desktop:linux` | `desktop/dist/` |
| Android (teste) | `npm run celular:android` | `celular/android/app/build/outputs/apk/debug/` |
| Android (assinado) | `npm run celular:android-assinado` | `celular/android/app/build/outputs/apk/release/` e `bundle/release/` |
| iPhone | `npm run celular:ios` (abre o Xcode; lá, clique em ▶ ou em Product > Archive) | — |

Cada comando já roda o `preparar` antes, que pega o `fonte/dente-sempre.html`, coloca o servidor e a chave, embaralha o código e copia para `desktop/www/` e `celular/www/`.

Testes automáticos (opcionais): `npm run verificar` abre a página embaralhada num navegador invisível e confere que a tela de entrada aparece sem erros (precisa do Playwright). `npm run desktop:testar` abre o aplicativo de computador e confere as travas de segurança (no Linux, não rode como root).

Só para teste na rede local, com servidor sem cadeado: `node preparar.js --permitir-http --servidor=http://192.168.0.10:3000`. **Nunca entregue esse aplicativo a clientes.** O Android não aceita `http://` (só `https://`).

## 4. Gerar pelo GitHub (sem instalar nada)

1. Preencha `app/config.json` com o endereço do servidor (`"servidor": "https://..."`) e a chave pública (`"chavePublica"`, a que o comando `dente-sempre chave-publica` mostra no servidor). Envie o arquivo para o GitHub. Não precisa criar secrets.
2. Vá em **Actions > Gerar aplicativos > Run workflow**. Ou crie uma etiqueta: `git tag v1.2.0` e `git push --tags`.
3. O primeiro passo confere o `config.json`. Se o servidor estiver vazio, com o endereço de exemplo ou sem `https://`, ou se a chave estiver vazia, ele para e diz o que falta.
4. Quando terminar, os arquivos ficam em **Artifacts**, no fim da página da execução: `dente-sempre-windows` (instalador .exe) e `dente-sempre-android` (APK de teste).

O GitHub gera só o Windows e o APK de teste do Android, sem assinatura. O Mac, o Linux e o APK/AAB assinado para a Google Play são gerados no seu computador (seção 3 e seção 5).

## 5. Assinatura digital

### Android (obrigatório para distribuir)

Crie a chave **uma vez** e guarde em lugar seguro. Se ela for perdida, não dá para atualizar o aplicativo nos celulares que já o instalaram.

```
keytool -genkeypair -v -keystore dente-sempre.jks -alias dente-sempre -keyalg RSA -keysize 4096 -validity 10000
```

- **No seu computador**: crie `celular/android/keystore.properties` (ele **não** vai para o GitHub):
  ```
  storeFile=/caminho/completo/dente-sempre.jks
  storePassword=senha-do-arquivo
  keyAlias=dente-sempre
  keyPassword=senha-da-chave
  ```
- **No GitHub**: o workflow atual não assina. Gere o APK e o AAB assinados no seu computador com `npm run celular:android-assinado`.

O APK de teste (debug) usa uma chave de teste. O número do aparelho que o Android dá ao aplicativo muda com a chave: um celular que usou o APK de teste vai precisar de ativação nova no APK assinado.

### Windows (recomendado)

Sem assinatura, o Windows mostra "O Windows protegeu o computador" (SmartScreen) e a pessoa precisa clicar em "Mais informações > Executar assim mesmo". Para assinar, compre um certificado de assinatura de código (hoje vem em token USB ou na nuvem, por exemplo Azure Trusted Signing). Com um arquivo .pfx, defina `CSC_LINK` (caminho ou base64 do .pfx) e `CSC_KEY_PASSWORD` antes de gerar. O workflow do GitHub gera o instalador sem assinatura.

### Mac (recomendado)

Sem assinatura, na primeira vez é preciso clicar com o botão direito no app e escolher **Abrir**. Para assinar e notarizar: conta Apple Developer, certificado "Developer ID Application" (`CSC_LINK` e `CSC_KEY_PASSWORD`) e `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID`. O Mac é gerado num Mac (`npm run desktop:mac`); o workflow do GitHub não gera Mac.

### iPhone

Abra `celular/ios/App/App.xcodeproj` no Xcode, escolha sua equipe (Signing & Capabilities) e use **Product > Archive** para enviar à App Store ou ao TestFlight. Se a pasta `celular/ios` não existir, rode `npx cap add ios` dentro de `celular/`.

## 6. Proteções dos aplicativos

**Computador (Windows, Mac, Linux):**
- O código vai embaralhado e dentro de um pacote fechado (asar) com conferência de integridade (Windows e Mac). Se alguém alterar o pacote, o programa não abre.
- A página roda isolada (sandbox): não tem acesso aos arquivos nem aos programas do computador.
- Só conversa com o servidor configurado. Qualquer outro endereço é bloqueado (proteção CSP e filtro de rede).
- Não navega para outros sites e não abre janelas extras. Links do WhatsApp abrem no navegador normal.
- Não pede câmera, microfone, localização nem notificações.
- Ferramentas de programador (DevTools), "porta de depuração" e modo Node.js ficam desligados no aplicativo instalado.
- Os dados ficam no endereço fixo `app://dente-sempre`, então não se perdem ao atualizar.
- Só abre uma janela por vez. Ao abrir de novo, traz para frente a que já está aberta.

**Celular (Android):**
- Só conexões `https://` com certificados oficiais (certificados instalados no celular não valem).
- Os dados da agenda não vão para o backup do Google e não passam para outro celular.
- Depuração da página desligada. Única permissão: internet.
- Links externos (WhatsApp) abrem fora do aplicativo.
