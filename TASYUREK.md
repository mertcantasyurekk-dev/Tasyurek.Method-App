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

## Haftalık koçluk: not, hedef, 360° Analiz, değerlendirme

Koç panelinde üye detayı (`views/CoachWeekly.jsx`, biçimler `lib/coach360.js`):
- **Koç notu ve hedef** (Cut / Clean Bulk / Recomposition / Bakım / Podyum): `coachnotes/{uid}` — **sadece koç**
  okur/yazar; üye kendi notunu da göremez. Kendi "Kaydet" düğmesi var.
- **360° Analiz**: "Analiz verisini kopyala" tracker'daki `=== TT-VERI v1 ===` biçimini **aynen** üretir
  (uid, analiz_haftası, `TT-REVIZE başlığında kullan: hafta=…`, koç notu, hedef, makro setleri, program,
  [BAŞLANGIÇ] / [N-1] / [N], top setler + e1RM, günlük notlar). Hafta sabit takvim haftası: [N] = en son Pazar ile
  biten Pzt→Paz. Isınma setleri sayılmaz. openGym'de vücut ölçüsü olmadığı için "ölçüler: —".
  İçe aktarma `[[TT-REVIZE uid=… hafta=…]]` bloğunu aynı kurallarla okur: uid zorunlu ve kartın üyesi olmalı
  (değilse kaydedilmez), hafta analiz haftası dışındaysa uyarı, MAKRO makul aralık dışındaysa yok sayılır.
  "Kaydet": RAPOR arşive (`coachnotes.reports`), MESAJ değerlendirme taslağına. "Makroları uygula…" onaydan sonra
  antrenman/dinlenme setlerini değiştirir, su/uyku hedefini korur.
- **Haftalık değerlendirme**: taslak (istersen otomatik taslak) → Gönder → `coachplan/{uid}.reviews`. Üye ana
  sayfada "Koçundan" kartında görür (okunmamışsa "Yeni"), tüm arşiv karttan ve Ayarlar'dan açılır. Geri alınabilir.
- **Tracker'dan aktar** (bir kez, taraf boşken): eski `coachNote`, `coachGoal`, `coachReports`,
  `weeklyRevisions` (orijinal tarihleriyle) gelir; `userdata`'ya yazılmaz.

## Beslenme (günlük takip)

Ana sayfadaki kart (`components/NutritionCard.jsx`, stiller `components/nutrition.css`): kcal halkası (makro
payları renkli), protein/karbonhidrat/yağ çubukları hedefe göre "kaldı / fazla / hedefte", su (çeyrek litre),
gün geçişi (geriye dönük giriş), **Yemek ekle** ve **Günün öğünleri**. Kcal = P×4 + K×4 + Y×9.

**Yemek ekleme (FatSecret benzeri)** — `components/FoodSheet.jsx`, `lib/foods.js`: öğün seçimi (saate göre
otomatik), Türkçe karakter duyarsız arama, "bu hafta eklediklerin", gram ya da porsiyon miktarı, peş peşe ekleme,
listede olmayan yemeği ortak listeye kaydetme, "sadece makro gir". Liste (`src/fooddata/foods-tr.json`, pencere
açılınca yüklenir, ~6 KB sıkıştırılmış, 242 kalem): tracker'ın 118 yemeği + USDA SR28'den (kamu malı) Türkçe
adlandırılmış ~124 temel gıda (et/balık, süt ürünleri, tahıllar, baklagiller, sebze, meyve, kuruyemiş, yağ/sos),
100 g bazlı ve uygun olanlarda hazır porsiyonlarla ("1 orta boy · 182 g"). USDA karbonhidratı lif dahildir;
alkollü içecekler (kalorisi makrolardan gelmez) ve çay/kahve bilinçli olarak yok. Kaynak verisi:
github.com/maxsu/USDA-SR28. + ortak liste
`sharedData/customFoods` (eski tracker'la **aynı belge ve biçim**, iki uygulama aynı listeyi paylaşır).

**Haftalık mühür — ne saklanır** (`lib/nutrition-core.js`): gün = `{ p, c, f, items, del, water, sleep, type,
sealedAt, _ts }`. Toplam = taban (p/c/f) + kalemler. İçinde bulunulan hafta öğün kalemlerini tutar; önceki
haftaların günleri mühürlenir: kalemler toplama katlanır ve silinir. Adaptör bunu Firestore'a **her yazışta ve her
okuyuşta** uygular (`compactNutrition`), yani arka planda eski haftalara ait "ne yendiği" hiç durmaz; sadece günlük
kcal ve makro kalır (yılda ~25 KB). "Toplamı düzelt" bir düzeltme kalemi (`x: 1`, eksi olabilir) ekler.
Senkron (`mergeNutrition`): bu haftanın kalemleri iki cihazdan birleşir, silinen geri gelmez; mühürlü gün
mühür öncesi kalemleri tekrar saymaz, mühürden sonra eklenenleri korur.
- Kilo openGym'in `bodyweight` kaydında kalır.
- Hedefler: koç panelinde üye detayı → **Beslenme** → antrenman ve dinlenme günü makro setleri, su, uyku.
  `coachplan/{uid}.targets` alanına yazılır (programla birbirini ezmez); üyede `S.coachTargets`, değiştiremez.
  Hedef yoksa form eski tracker'ın `customMacroTargets`/`targets` değerleriyle dolu açılır. Sınırlar: P ≤ 500,
  K ≤ 1000, Y ≤ 300, su ≤ 10 L, uyku ≤ 14 sa.
- Gün tipi otomatik (planlı rutin ya da kayıtlı antrenman → antrenman günü); üye elle çevirebilir.
- Koç kendi hedeflerini kartın altındaki "Kendi hedeflerini belirle"den koyar (`S.myTargets`).
- Koç panelinde son 7 günün ortalaması (kayıt olan günler) görünür.
- Tracker'dan aktarma günlük makro/su/uyku değerlerini de getirir (sadece uygulamada o gün için değer yoksa; tekrar aktarımda çoğalmaz).

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

Koç notları için (sadece koç):

```
    match /coachnotes/{uid} {
      allow read, write: if isCoach();
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
