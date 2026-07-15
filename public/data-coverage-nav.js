/** Nav chip: per-company "data through" dates from /api/data-coverage */
(function () {
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatThroughDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
  }

  function companyLabel(co) {
    return co === 'nyuuly' ? 'Nyuuly' : 'WORK JAPAN';
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
      const parts = [];
      for (const co of ['workjapan', 'nyuuly']) {
        const row = data[co];
        if (row?.dataThroughDate) {
          parts.push(`${companyLabel(co)} ${formatThroughDate(row.dataThroughDate)}`);
        }
      }
      setNavText(parts.length ? `Data through: ${parts.join(' · ')}` : 'Data through: —');
    } catch (_) {
      setNavText('Data through: —');
    }
  }

  window.loadNavDataCoverage = loadNavDataCoverage;
  window.loadNavDataCoverageAll = loadNavDataCoverageAll;
})();
