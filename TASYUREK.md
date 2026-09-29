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

## Marka

Firebase derlemesinde üye her yerde "Taşyürek Method" görür: giriş ekranı (MT logosu), ana ekran ikonu,
sayfa başlığı, manifest ve çeviri metinleri (`i18n-core.js` içindeki `t()` "openGym"i marka adıyla değiştirir).
AGPL'in istediği bildirimler Ayarlar'ın en altındaki **Açık kaynak lisansları** bağlantısında
(`components/Licenses.jsx`): orijinal telif, lisans, garanti yok ifadesi ve bu reponun kaynak kodu.
Bu bağlantı ve orijinal telif satırı kaldırılmamalıdır.

## Firebase derlemesinde herkes için kapalı

Salonda giriş (üyelik QR kartları, `/checkin`), başlangıç planları, başka uygulamalardan içe aktarma, güncellemeler.

## Koçlu üye kilidi

`lib/coached.js`: `isCoached(user)` = Firebase derlemesi ve admin değil. Koçlu üye:
- Plan yerine salt okunur **Programım** ekranını görür (`views/CoachedPlan.jsx`); rutin düzenleme adresi Plan'a yönlenir.
- Antrenmanda sadece set girer: hareket/set ekleme-çıkarma, değiştirme, sıralama, süperset, ilerleme ayarı,
  seansa rutin ekleme, yeniden adlandırma yok. Serbest antrenman yok (başlatma ve geçmişe kayıtta).
- Egzersizler'de kendi hareketini oluşturamaz, plana ekleyemez.
- Ayarlar'da sadece çıkış, tracker'dan aktarma ve yedeği dışa aktarma; içe aktarma ve sıfırlama yok.
- Kilo hedefi koyamaz (Ana sayfa ve İstatistik'te "Hedef" yok); hedef çizgisi sadece koç koyarsa görünür.
- "Planlı seansların çıkış noktası" ayarı yok ve her zaman koçun reçetesi (`startFrom: 'plan'`); adaptör zorlar.
- Başka günün rutinini seçmek (hasta olunca vb.) serbest: sadece koçun rutinleri arasında seçim.
Admin (koç) tam uygulamayı kullanır. AI Koç Firebase derlemesinde zaten kapalıdır (`/api/config` koç bilgisi göndermez).

## Koç paneli ve program atama

Admin hesabında Ana sayfa ve Ayarlar'da **Koç paneli** (`views/CoachPanel.jsx`, `/panel`).
- Üye listesi: son antrenman, son 7 gün, programı olup olmadığı. Üye detayı: özet, atanan program, son antrenmanlar.
- Rutinler koçun kendi Plan sekmesinde openGym editörüyle hazırlanır. **Program ata**, seçilen rutinleri ve haftalık
  takvimi `coachplan/{uid}` belgesine yazar (`plan`: JSON metni, `rev`, `updatedAt`, `by`). Rutin kimlikleri korunur,
  böylece üyenin geçmişi aynı rutinlere bağlı kalır. "Seda · " gibi önekler üyeye giderken silinir.
- **Programını Plan sekmeme kopyala**: üyenin mevcut programını (atanmış plan ya da tracker'dan gelen rutinleri)
  aynı kimliklerle koçun Plan sekmesine alır; düzenleyip tekrar atanır.
- Üyenin uygulaması her okumada planı kendi kopyasının üzerine koyar (`applyPlan`): rutinler, hafta ve plandaki
  kullanıcı hareketleri koçunkidir. Revizyon iki belgenin birleşimidir (`planRev * 1000000 + ogRev`), böylece açık
  duran uygulama koçun değişikliğini fark eder.
- Koç, üyenin `ogstate` belgesine **hiç yazmaz**; sadece okur.

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

Koç planı için ayrıca:

```
    match /coachplan/{uid} {
      allow get: if request.auth != null && (request.auth.uid == uid || isCoach());
      allow list, create, update, delete: if isCoach();
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
