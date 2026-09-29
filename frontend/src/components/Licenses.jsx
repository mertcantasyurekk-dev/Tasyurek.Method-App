// Taşyürek Method: the notices the AGPL asks a modified version to keep reachable from its
// interface (§5d, §7b): the original copyright, the licence, no warranty, and where the source of
// THIS version is. One tap from the foot of Settings.
import { useUI } from '../store/useUI.js'
import { Button } from './ui.jsx'

const SOURCE = 'https://github.com/mertcantasyurekk-dev/Tasyurek.Method-App'

function Licenses({ close }) {
  const a = (href, text) => <a href={href} target="_blank" rel="noopener">{text}</a>
  return <div className="small" style={{ lineHeight: 1.6 }}>
    <h3>Açık kaynak lisansları</h3>
    <p>Taşyürek Method uygulaması, açık kaynaklı <b>openGym</b> projesi temel alınarak Mertcan Taşyürek
      tarafından uyarlanmıştır. openGym — Copyright © 2026 Duarte Santos.</p>
    <p>Bu uygulama <b>GNU Affero General Public License v3.0</b> (AGPL-3.0) altında lisanslanmıştır.
      Lisans koşulları çerçevesinde kopyalayabilir, değiştirebilir ve dağıtabilirsiniz. Uygulama,
      yürürlükteki hukukun izin verdiği ölçüde <b>hiçbir garanti olmaksızın</b> sunulur.</p>
    <p>Bu sürümün kaynak kodu: {a(SOURCE, 'github.com/mertcantasyurekk-dev/Tasyurek.Method-App')}<br />
      Lisans metni: {a('https://www.gnu.org/licenses/agpl-3.0.html', 'gnu.org/licenses/agpl-3.0')}<br />
      Orijinal proje: {a('https://github.com/DuarteSantos8/openGym', 'github.com/DuarteSantos8/openGym')}</p>
    <p>Hareket verileri: hasaneyldrm/exercises-dataset (MIT). Hareket görselleri ve animasyonları ©
      Gym visual. Vücut diyagramı: MuscleMap, Melih Colpan (MIT).</p>
    <Button onClick={close}>Kapat</Button>
  </div>
}

export const openLicenses = () => useUI.getState().openSheet(close => <Licenses close={close} />)
