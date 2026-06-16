'use strict';
// Thin wrappers over Chart.js (loaded globally from CDN in index.html).
// Shared spartan styling: hairline grid, ink line, monospace tick labels.

const sInk = '#2b2118';
const sAccent = '#876a37';
const sLine = '#d8c39a';
const sMuted = '#a08b67';
const sMono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function baseOptions(tExtra) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 280 },
    plugins: { legend: { display: false }, tooltip: {
      backgroundColor: sInk, padding: 9, cornerRadius: 6,
      titleFont: { family: sMono, size: 11 }, bodyFont: { family: sMono, size: 12 },
    } },
    scales: {
      x: { grid: { display: false }, border: { color: sLine },
           ticks: { color: sMuted, font: { family: sMono, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
      y: { grid: { color: sLine, drawTicks: false }, border: { display: false },
           ticks: { color: sMuted, font: { family: sMono, size: 10 }, maxTicksLimit: 5 } },
    },
  }, tExtra || {});
}

const oCharts = new WeakMap();

function draw(tCanvas, tConfig) {
  if (!window.Chart) return null;
  const oPrev = oCharts.get(tCanvas);
  if (oPrev) oPrev.destroy();
  const oChart = new window.Chart(tCanvas.getContext('2d'), tConfig);
  oCharts.set(tCanvas, oChart);
  return oChart;
}

const sDanger = '#8c2f20';

// Single ink line chart over labelled points.
// oOpts.notes: optional array aligned to tData; points with a note are drawn as
// red diamonds and their note shows in the tooltip.
export function lineChart(tCanvas, tLabels, tData, tOptions) {
  const oOpts = tOptions || {};
  const aNotes = oOpts.notes || null;
  const sPointColor = oOpts.accent ? sAccent : sInk;
  const iBaseRadius = tData.length > 25 ? 0 : 3;

  const oExtra = oOpts.scales ? { scales: oOpts.scales } : {};
  if (aNotes) {
    oExtra.plugins = { tooltip: { callbacks: {
      afterBody: (tItems) => {
        const sNote = tItems.length ? aNotes[tItems[0].dataIndex] : null;
        return sNote ? ['', '✎ ' + sNote] : [];
      },
    } } };
  }

  return draw(tCanvas, {
    type: 'line',
    data: {
      labels: tLabels,
      datasets: [{
        data: tData,
        borderColor: sPointColor,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.25,
        pointRadius: aNotes ? tData.map((_, i) => (aNotes[i] ? 5 : iBaseRadius)) : iBaseRadius,
        pointHoverRadius: aNotes ? tData.map((_, i) => (aNotes[i] ? 7 : 5)) : 5,
        pointStyle: aNotes ? tData.map((_, i) => (aNotes[i] ? 'rectRot' : 'circle')) : 'circle',
        pointBackgroundColor: aNotes ? tData.map((_, i) => (aNotes[i] ? sDanger : sPointColor)) : sPointColor,
        pointBorderColor: aNotes ? tData.map((_, i) => (aNotes[i] ? sDanger : sPointColor)) : sPointColor,
        spanGaps: true,
      }],
    },
    options: baseOptions(oExtra),
  });
}

// Vertical bars (e.g. daily calories).
export function barChart(tCanvas, tLabels, tData) {
  return draw(tCanvas, {
    type: 'bar',
    data: {
      labels: tLabels,
      datasets: [{ data: tData, backgroundColor: sAccent, borderRadius: 3, maxBarThickness: 22 }],
    },
    options: baseOptions(),
  });
}

// A compact progress ring used for the daily calorie goal.
export function ring(tCanvas, tValue, tGoal) {
  const fPct = tGoal > 0 ? Math.min(tValue / tGoal, 1) : 0;
  return draw(tCanvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [fPct, 1 - fPct],
        backgroundColor: [sAccent, sLine],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '76%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 320 },
    },
  });
}
