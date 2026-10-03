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

## Kardiyo, haftalık hedefler, takviyeler, günün notu

`lib/daily.js`, `lib/daily-message.js`, kartlar `components/DailyCards.jsx`.
- **Kardiyo**: `S.cardio[tarih] = { items: [{ id, type, min, t }], del, _ts }` (tür değerleri tracker'ınki: "Walking",
  "HIIT"…; Türkçe etiketlerle gösterilir). Senkron kalem bazında. Antrenman içindeki openGym kardiyo hareketleri de sayılır;
  sadece kardiyodan oluşan antrenman "antrenman" sayılmaz.
- **Haftalık hedefler** (koç, hedef formunda "Haftalık"): `coachTargets.workoutsPerWeek`, `cardioSessionsPerWeek`,
  `cardioMinutesPerWeek`. Ana sayfada "Bu hafta" kartı: üç halka (antrenman altın, kardiyo mavi, süre turkuaz; hedef
  tamamlanınca yeşil ve etikette ✓, açılışta dolma animasyonu), 7 günlük şerit (antrenman işareti + kardiyo dakikası
  sütunu, bugün vurgulu), kardiyo ekle, bugünün kardiyosu. Halkalar kart genişliğiyle ölçeklenir (en çok 112 px).
  "Makroları uygula" artık diğer hedefleri (su, uyku, haftalık) korur.
- **Takviyeler**: koç üye detayında gruplu liste kurar (tracker'ın `customSupplements` biçimi, `coachplan.supplements`);
  "Tracker'dan al" ile gelir. Üye Ana sayfada her gün işaretler: `S.supps[tarih] = { on: { itemId: true }, _ts }`
  (senkron: gün bazında son işaretleyen). Koç Özet'te 7 günlük uyumu görür.
- **Günün notu**: üyenin kendi rakamlarından kural tabanlı mesaj (bugün antrenman yapıldı mı, haftalık hedef açığı,
  son iki gün protein, dünkü kayıt/isabet, uyku, kardiyo açığı, kayıt serisi, ölçüm zamanı, takviye uyumu). En ağır
  kural kazanır, cümle güne göre döner, gün içinde sabit kalır, kapatılabilir. Kilo yönü hakkında yorum yapmaz (hedef koçta).
- 360°: kardiyo satırı kardiyo kaydını da sayar; [N]'de `takviye uyumu: %…`.
- **Koçun kendi hedefleri ve takviyeleri** (kendi antrenmanı için): Ayarlar → **Hedeflerim** (`S.myTargets`: makro setleri,
  su, uyku, haftalık) ve **Takviyelerim** (`S.mySupplements`); beslenme kartındaki "Hedeflerimi düzenle" bağlantısı da
  hep durur. Takviye düzenleyicisi ortak bileşen (`components/SupplementsEditor.jsx`), koç panelinde üyeler için de o.
- Tracker'dan: günlük kardiyo, takviye işaretleri (üye aktarımı); takviye listesi ve haftalık hedefler (koçun program aktarımı).

## Koç paneli: üye özeti ve "Dikkat gerekenler"

`lib/member-summary.js`. Üye her kaydettiğinde adaptör `ogstate/{uid}.summary` alanına ~1 KB özet yazar (son 21 gün,
gün gün: antrenman, kardiyo dk, kcal, protein, tartı; son antrenman/tartı/kayıt/ölçüm tarihleri). Panel listesi sadece
özetleri okur (`runQuery` + `select`), üyelerin tam verisini değil — testte 3 üyede ~880 KB yerine 3 KB. Özeti olmayan eski
belge bir kez tam veriden özetlenir. Hesaplar panelin açıldığı güne göre yapılır (`statsOf`).
**Dikkat gerekenler** (`attentionOf`, önem sırasıyla): kırmızı — X gündür kayıt yok (≥3), haftalık hedefe yetişemiyor;
turuncu — hafta sıkışık, protein düşük (son 3 kayıtlı gün ort. < hedefin %85'i), beslenme kaydı seyrek (≤3/7),
X gündür tartılmadı (≥4), program atanmamış; gri — ölçüm ≥10 gündür yok, uygulamayı açmadı.
Üye detayı artık tüm listeyi indirmez (`/api/coach/member` adı/e-postayı da döndürür).

**Günün notu** motive edici tonda yeniden yazıldı (önce çabayı gör, rakamla somutla, açığı fırsat olarak çerçevele,
eylemle bitir); yeni olumlu kurallar: hafta temposunda (`week-on-track`), kardiyo yarıyı geçti (`cardio-progress`).
"Hafta geride" ikiye ayrıldı: her kalan gün gerekiyorsa acil (`week-behind`), biri eksikse nazik (`week-pace`).

## Vücut ölçüleri

`lib/measurements.js`, Ana sayfa kartı `components/MeasurementsCard.jsx`. Tracker'ın 10 alanı ve anahtarları: omuz
(`shoulder`), göğüs (`chest`), sol/sağ kol (`armL`/`armR`), bel üst/göbek/alt (`waistUpper`/`waistNavel`/`waistLower`),
kalça (`hips`), sol/sağ bacak (`legL`/`legR`), cm. `S.measurements = [{ d, …alanlar, t }]`, günde bir kayıt, kısmi olabilir,
silinen gün `{ d, del: true, t }` olarak kalır. Senkron: gün bazında son yazılan (`mergeMeasurements`, `sync-merge.js`).
- Üye: kartta her ölçü + değişim ("önceki ölçüme göre" / "başlangıca göre", renk yok: yorum koçun), "Ölç" (alan başına
  ölçüm tarifi, son değerler silik ipucu, geçmiş tarih seçilebilir), "Geçmiş" (ölçü başına grafik, günler, silme).
  7 gün dolunca kart "Haftalık ölçüm zamanı" der. Değişim her alan için kendi önceki/ilk ölçümüne göredir.
- Koç: üye detayında tablo (başlangıç / şimdi / toplam / son), Özet'te son ölçüm tarihi.
- 360°: `ölçüler:` satırı tracker biçiminde — [BAŞLANGIÇ] ilk ölçüm, [N-1]/[N] o haftadaki son ölçüm.
- Tracker'dan aktarma ölçüleri de getirir (uygulamada o gün kaydı yoksa).

## Tam geçiş (tracker → yeni uygulama)

- **Otomatik aktarım** (`autoImportFromTracker`, `components/TrackerImport.jsx`): herkes (koç dahil) yeni uygulamaya ilk
  girişinde, profilinde `trackerImport` damgası yoksa, ~3,5 sn sonra tracker geçmişini kendiliğinden alır (antrenman, kilo,
  beslenme, ölçü, kardiyo, takviye işaretleri; koç programı yoksa rutinler). Tracker antrenmanları sabit kimlik alır
  (`tt-w-<id>`), iki cihazda ya da iki kez aktarmak çift kayıt yaratmaz. Ayarlar'daki elle aktarma kalır (geçişten sonra
  eski uygulamaya girilenleri getirmek için).
- **Geçiş ekranı** (Koç paneli → **Tracker'dan geçiş**, `components/MigrationSheet.jsx`): her üyenin gerçek tracker
  verisinden yazmadan önizleme (program, antrenman sayısı ve tarih aralığı, kilo, beslenme günleri, ölçüm, kardiyo,
  kütüphaneyle eşleşmeyen hareket adları) + koçun kendi verisinin önizlemesi; **Koç tarafını taşı**: sadece eksik olanlar
  (program, hedefler, takviyeler, not/hedef/raporlar, değerlendirmeler).
- **Tracker'dan gelen her şey:** antrenmanlar (set set kilo/tekrar, **süreleri** `workoutTimers`'tan), günlük kilolar +
  **ölçüm formundaki kilo** (o gün günlük kilo yoksa), 10 alanlı ölçüler, günlük makrolar (önceki haftalar toplam; **bu haftanın
  öğünleri** `mealLog`'dan öğün öğün; makrosu girilmemiş günlerde öğün toplamı), su, uyku, **gün tipi seçimleri**
  (`customDayTypeChoice`), **günlük notlar** (`S.dayNotes`, Günün öğünleri → Günün notu; 360° "günlük notlar"),
  kardiyo, takviye işaretleri, **önceki rekorlar** (`priorBests` → "Önceki rekorlar (tracker)" oturumu, ilk antrenmandan
  bir gün önce). Tracker antrenmanları **kimlikle** birleşir (tarihle değil): yeni uygulamada aynı güne antrenman olsa da kaybolmaz.
  Aktarılmayan: kayıtlı öğün şablonları (`mealTemplates`, yeni uygulamada özellik yok), önceki haftaların öğün detayı
  (karar gereği sadece toplam), seans içi hedef notları; ısınma setleri tracker'da ayırt edilmediği için normal set olarak gelir.
- **Doğrulama** (`verifyImport`): geçiş ekranında, aktarım yapılmış her üye ve koç için tür tür "tracker / yeni" sayıları
  (✓ ya da ⚠ eksik).
- Tracker'dan taşınan değerlendirmeler `imported: true` taşır: Ana sayfadaki "Koçundan" kartında "yeni" görünmez, arşivde durur.
- Eski tracker'ın `TT-MOVED` sürümü (ayrı dosya, geçiş günü yayınlanır): üye girişinde uygulama yüklenmez; cihazda
  gönderilmemiş kayıt varsa önce birleştirilerek yazılır, sonra yeni uygulamaya yönlendiren ekran. Koç eski uygulamayı kullanır.

## Tracker programlarının aktarımı

Koç panelinde **Tracker programlarını aktar** (hepsi birden) ya da üye detayında **Tracker programını ata**
(`components/TrackerTransfer.jsx`, `trackerPlan` in `lib/tracker-import.js`): üyenin tracker'daki aktif programı
koç programı olarak `coachplan/{uid}`'e yazılır. Rutin kimlikleri sabittir (`tt-<programId>-<dayId>`), tekrar
aktarmak aynı rutinleri günceller. Günler sırayla haftaya yerleşir (3 gün → Pzt/Çar/Cum, 5 gün → Pzt–Cum…),
sonra "Programı güncelle" ile değiştirilir. Kullanıcı hareketleri üyenin kendi (geçmişten gelen) hareketleriyle
adından eşleşir. Üyenin burada hedefi yoksa tracker'daki makro hedefleri de gelir. `userdata`'ya yazılmaz.

## Yedekleme

Koç panelinde **Yedekler** (`components/Backup.jsx`, sunucu tarafı `firebase-api.js` "backups"):
- **Otomatik**: koç uygulamayı açınca, son yedek 2+ takvim günü eskiyse `backups/og_YYYY-AA-GG`'ye yazılır.
  İçerik: `userdata` (tracker), `ogstate`, `coachplan`, `coachnotes`, `sharedData/customFoods` — Firestore'daki
  tipli alanlarıyla (birebir geri yüklenebilir). 800 KB üstü üye başına bölünür (`og_TARİH__<uid>` + ana belge).
  Son 15 yedek tutulur; tracker'ın `backup_…` yedeklerine dokunulmaz. `backups/_og_meta` son yedeği tutar.
  Yeni Firestore kuralı gerekmez (`backups/{id}` zaten koça açık).
- **Manuel**: "Şimdi yedekle" ve "Tam yedeği bilgisayarıma indir" (JSON).
- Geri yükleme henüz otomatik değil: yedek dosyasından/belgesinden elle yapılır.

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
