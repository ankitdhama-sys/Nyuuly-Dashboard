/** Nav chip: per-company "data through" dates from /api/data-coverage */
(function () {
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatThroughDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
  }

  function companyLabel(co) {
    if (co === 'nyuuly') return 'Nyuuly';
    if (co === 'workjapan') return 'WORK JAPAN';
    const gtmLabels = { nepal: 'Nepal', vietnam: 'Vietnam', taiwan: 'Taiwan' };
    return gtmLabels[co] || co;
  }

  function setNavText(text) {
    const el = document.getElementById('dataThroughNav');
    if (el) el.textContent = text;
  }

  async function loadNavDataCoverage(company) {
    try {
      const res = await fetch(`/api/data-coverage?company=${encodeURIComponent(company)}`);
      const data = await res.json();
      if (!data.dataThroughDate) {
        setNavText('Data through: —');
        return;
      }
      setNavText(`Data through: ${formatThroughDate(data.dataThroughDate)} (${companyLabel(company)})`);
    } catch (_) {
      setNavText('Data through: —');
    }
  }

  async function loadNavDataCoverageAll() {
    try {
      const res = await fetch('/api/data-coverage');
      const data = await res.json();
      const wj = data.workjapan?.dataThroughDate || null;
      const ny = data.nyuuly?.dataThroughDate || null;
      if (wj && ny && wj === ny) {
        setNavText(`Data through: ${formatThroughDate(wj)}`);
        return;
      }
      const parts = [];
      if (wj) parts.push(`${companyLabel('workjapan')} ${formatThroughDate(wj)}`);
      if (ny) parts.push(`${companyLabel('nyuuly')} ${formatThroughDate(ny)}`);
      setNavText(parts.length ? `Data through: ${parts.join(' · ')}` : 'Data through: —');
    } catch (_) {
      setNavText('Data through: —');
    }
  }

  window.loadNavDataCoverage = loadNavDataCoverage;
  window.loadNavDataCoverageAll = loadNavDataCoverageAll;
})();
