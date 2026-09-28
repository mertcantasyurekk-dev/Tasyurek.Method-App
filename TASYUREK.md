# Taşyürek Method — openGym çatalı

Bu repo, [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym) (AGPL-3.0) üzerine kuruludur.
Kaynak kodu AGPL-3.0 altında açıktır. openGym'in lisans ve telif bildirimleri (LICENSE, NOTICE.md) korunmalıdır.

## Upstream'den farklar

Sunucu yok. Uygulama GitHub Pages'te statik olarak çalışır ve Firebase'e (Auth + Firestore) REST ile bağlanır.

- `frontend/src/lib/firebase-api.js`: openGym'in `/api/*` uçlarını Firestore üzerinde taklit eden adaptör
  (giriş, token yenileme, `/api/me`, `/api/data` ve revizyon/çakışma kontrolü). Olmayan uçlar 404 döner.
- `frontend/src/lib/api.js`: `VITE_FIREBASE=1` iken istekleri adaptöre yönlendiren tek satırlık kanca.
- `frontend/src/views/Login.jsx`: Firebase modunda sadece e-posta + şifre ile giriş.
- `.github/workflows/pages.yml`: Firebase modunda derleyip Pages'e yayınlar. GIF'ler tracker reposundan gelir.
- Docker/ghcr yayın ve mirror iş akışları kaldırıldı.

## Eski Tracker'dan aktarma

Ayarlar → Veriler → **Eski Tracker'dan aktar**. Her üye kendi hesabında yapar.
`userdata/{uid}.payload` sadece okunur (alan maskesiyle), asla yazılmaz.

- Aktif programın günleri rutin olur (sadece ilk aktarmada). "8-10" → çift progresyon, ısınma setleri → `warmupSets`, RIR ve not → hareket notu.
- Antrenmanlar ve günlük kilolar openGym'in `mergeImport`'undan geçer: burada zaten antrenmanı olan gün atlanır, tekrar aktarmak hiçbir şeyi çoğaltmaz.
- Hareket adı kütüphane adıyla **birebir** aynıysa kütüphaneye bağlanır, değilse koçun yazdığı adla kullanıcı hareketi olur (yanlış eşleşme geçmişi bozmasın diye bulanık eşleştirme yok).
- Beslenme, su, uyku, kardiyo ve ölçüler henüz aktarılmıyor.
- Kod: `frontend/src/lib/tracker-import.js`, `frontend/src/components/TrackerImport.jsx`.

## Veri

Her üye için `ogstate/{uid}` belgesi: `state` (JSON metni), `rev` (sayı), `email`, `updatedAt`.
Tracker'ın `userdata/{uid}` belgesine **hiç yazılmaz**. Sadece `displayName` alanı okunur.
Yazmalar Firestore ön koşuluyla (`currentDocument.updateTime`) yapılır. İki cihaz aynı anda yazarsa
biri 409 alır ve openGym'in kendi birleştirme mantığı devreye girer.

## Firestore kuralı (Console → Firestore → Rules, mevcut kurallara EKLE)

```
    match /ogstate/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      allow read: if request.auth != null &&
        request.auth.token.email == 'mertcan.tasyurekk@gmail.com';
    }
```

## Upstream güncellemelerini almak

```
git remote add upstream https://github.com/DuarteSantos8/openGym.git
git fetch upstream
git merge upstream/main
cd frontend && npm ci && npx vitest run src/lib/firebase-api.test.js
```

## Bilinen

- `src/store/useStore.media.test.jsx` içindeki bir test upstream'de de ara ara düşüyor (flaky), bizimle ilgisi yok.
