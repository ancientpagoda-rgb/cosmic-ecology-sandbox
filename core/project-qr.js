const PROJECT_URL = 'https://ancientpagoda-rgb.github.io/cosmic-ecology-sandbox/';
const QR_SIZE = 41;
const QR_ROWS = ["00000000000", "00000000000", "00000000000", "00000000000", "0fe38b53f80", "08279282080", "0babb862e80", "0bae142ae80", "0bad7f92e80", "082e00a2080", "0feaaaabf80", "00080940000", "0be66c2be00", "0d96edb3680", "0a297c20b00", "0e9a52eee80", "043024bcd80", "048f13d2180", "02bf1ee6f00", "03c68ac6e00", "00b6053d880", "00c2ebb3680", "027038e7a00", "0f828bdde80", "01f7752dc00", "085e435a480", "0ba1d4c0d00", "0b91d05d380", "08f7c52f880", "000b4b88a80", "0fe6f6bab00", "082a8bf8f00", "0baeecafd00", "0baf4bc4d80", "0bad1ed3400", "08274be2e00", "0fe8863d100", "00000000000", "00000000000", "00000000000", "00000000000"];

function rowBits(hex) {
  return BigInt(`0x${hex}`).toString(2).padStart(hex.length * 4, '0').slice(0, QR_SIZE);
}

function qrSvg() {
  let path = '';
  for (let y = 0; y < QR_SIZE; y += 1) {
    const bits = rowBits(QR_ROWS[y]);
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (bits[x] === '1') path += `M${x} ${y}h1v1H${x}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${QR_SIZE} ${QR_SIZE}" aria-hidden="true"><rect width="${QR_SIZE}" height="${QR_SIZE}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

function installProjectQr() {
  if (document.querySelector('[data-project-qr]')) return;

  const style = document.createElement('style');
  style.id = 'eidolon-project-qr-style';
  style.textContent = `
    .eidolon-project-qr{
      position:fixed;
      right:max(12px,env(safe-area-inset-right));
      bottom:max(12px,env(safe-area-inset-bottom));
      z-index:40;
      width:72px;
      height:72px;
      box-sizing:border-box;
      padding:4px;
      border-radius:8px;
      background:#fff;
      box-shadow:0 2px 12px rgb(0 0 0/.38);
      opacity:.72;
      transition:opacity .15s ease,transform .15s ease;
      touch-action:manipulation;
    }
    .eidolon-project-qr:hover,
    .eidolon-project-qr:focus-visible{
      opacity:1;
      transform:scale(1.04);
      outline:2px solid #f4f0bd;
      outline-offset:2px;
    }
    .eidolon-project-qr svg{display:block;width:100%;height:100%;shape-rendering:crispEdges}
    @media (max-width:720px){
      .eidolon-project-qr{
        width:64px;
        height:64px;
        right:max(8px,env(safe-area-inset-right));
        bottom:max(8px,env(safe-area-inset-bottom));
        padding:3px;
      }
    }
  `;
  document.head.append(style);

  const link = document.createElement('a');
  link.className = 'eidolon-project-qr';
  link.dataset.projectQr = 'true';
  link.href = PROJECT_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Open the Eidolon project');
  link.title = 'Open Eidolon';
  link.innerHTML = qrSvg();
  document.body.append(link);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProjectQr, { once: true });
} else {
  installProjectQr();
}
