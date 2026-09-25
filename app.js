const $ = (id) => document.getElementById(id);

const inputs = {
  initialLoan: $("initialLoan"),
  principal: $("principal"),
  rate: $("rate"),
  originalTerm: $("originalTerm"),
  propertyTax: $("propertyTax"),
  insurance: $("insurance"),
  extra: $("extraPayment")
};

const storageKey = "mortgage-time-machine:state:v2";
const legacyStoragePrefix = "mortgage-time-machine:";

const formatMoney = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

function restoreInputs() {
  let savedState = null;
  const serializedState = localStorage.getItem(storageKey);

  if (serializedState) {
    try {
      savedState = JSON.parse(serializedState);
    } catch (error) {
      console.error("Could not restore saved mortgage inputs.", error);
      localStorage.removeItem(storageKey);
    }
  }

  Object.entries(inputs).forEach(([name, input]) => {
    const savedValue = savedState?.[name] ?? localStorage.getItem(`${legacyStoragePrefix}${name}`);
    if (savedValue !== null && savedValue !== undefined) input.value = savedValue;
  });
}

function saveInputs() {
  const state = Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [name, input.value])
  );
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function monthlyPayment(principal, annualRate, months) {
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return principal / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return principal * monthlyRate * factor / (factor - 1);
}

function amortize(principal, annualRate, scheduledPayment, extraPayment) {
  const monthlyRate = annualRate / 100 / 12;
  let balance = principal;
  let interest = 0;
  let months = 0;
  const maxMonths = 1200;

  while (balance > 0.01 && months < maxMonths) {
    const monthlyInterest = balance * monthlyRate;
    let principalPaid = scheduledPayment - monthlyInterest + extraPayment;

    if (principalPaid <= 0) return { months: maxMonths, interest: Infinity };
    principalPaid = Math.min(principalPaid, balance);
    balance -= principalPaid;
    interest += monthlyInterest;
    months++;
  }

  return { months, interest };
}

function interestSeries(principal, annualRate, scheduledPayment, extraPayment) {
  const monthlyRate = annualRate / 100 / 12;
  let balance = principal;
  let cumulativeInterest = 0;
  let month = 0;
  const points = [{ month: 0, interest: 0 }];

  while (balance > 0.01 && month < 1200) {
    const monthlyInterest = balance * monthlyRate;
    let principalPaid = scheduledPayment - monthlyInterest + extraPayment;
    if (principalPaid <= 0) break;
    principalPaid = Math.min(principalPaid, balance);
    balance -= principalPaid;
    cumulativeInterest += monthlyInterest;
    month++;

    if (month % 3 === 0 || balance <= 0.01) {
      points.push({ month, interest: cumulativeInterest });
    }
  }

  return points;
}

function payoffLabel(months) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function buildDecorations() {
  const calendar = $("calendar");
  calendar.innerHTML = Array.from({ length: 96 }, (_, i) => `<i data-cell="${i}"></i>`).join("");

  const coins = $("coinStack");
  coins.innerHTML = Array.from({ length: 15 }, (_, i) => {
    const rotation = (i % 3 - 1) * 1.8;
    const shift = (i % 4 - 2) * 4;
    return `<i style="--r:${rotation}deg;--x:${shift}px"></i>`;
  }).join("");
}

function buildTimeline(termYears, acceleratedYears) {
  const wholeYears = Math.ceil(termYears);
  const original = $("originalTrack");
  const accelerated = $("acceleratedTrack");
  original.style.gridTemplateColumns = `repeat(${Math.min(wholeYears, 30)}, 1fr)`;
  accelerated.style.gridTemplateColumns = `repeat(${Math.min(wholeYears, 30)}, 1fr)`;

  original.innerHTML = "";
  accelerated.innerHTML = "";

  for (let year = 0; year < wholeYears; year++) {
    original.insertAdjacentHTML("beforeend", "<i></i>");
    const block = document.createElement("i");
    if (year >= acceleratedYears) {
      block.className = "reclaimed";
    } else if (year + 1 > acceleratedYears) {
      block.className = "partial";
      block.style.setProperty("--fill", `${Math.max(0, acceleratedYears - year) * 100}%`);
    }
    accelerated.appendChild(block);
  }
}

function drawInterestChart(originalSeries, acceleratedSeries) {
  const width = 1000;
  const height = 440;
  const margin = { top: 20, right: 26, bottom: 45, left: 82 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const lastOriginal = originalSeries.at(-1);
  const lastAccelerated = acceleratedSeries.at(-1);
  const maxMonths = Math.max(1, lastOriginal.month);
  const maxInterest = Math.max(1, lastOriginal.interest);
  const x = (month) => margin.left + month / maxMonths * plotWidth;
  const y = (interest) => margin.top + plotHeight - interest / maxInterest * plotHeight;
  const path = (series) => series.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${x(point.month).toFixed(1)} ${y(point.interest).toFixed(1)}`
  ).join(" ");
  const interestAtMonth = (series, month) => {
    const nextIndex = series.findIndex((point) => point.month >= month);
    if (nextIndex <= 0) return series[Math.max(0, nextIndex)].interest;
    if (nextIndex === -1) return series.at(-1).interest;
    const before = series[nextIndex - 1];
    const after = series[nextIndex];
    const ratio = (month - before.month) / (after.month - before.month);
    return before.interest + (after.interest - before.interest) * ratio;
  };

  const originalPath = path(originalSeries);
  const acceleratedDisplaySeries = lastAccelerated.month < lastOriginal.month
    ? [...acceleratedSeries, { month: lastOriginal.month, interest: lastAccelerated.interest }]
    : acceleratedSeries;
  const acceleratedPath = path(acceleratedDisplaySeries);
  $("originalInterestPath").setAttribute("d", originalPath);
  $("acceleratedInterestPath").setAttribute("d", acceleratedPath);

  const areaPath = `${acceleratedPath} ${
    originalSeries.slice().reverse().map((point) =>
      `L ${x(point.month).toFixed(1)} ${y(point.interest).toFixed(1)}`
    ).join(" ")
  } Z`;
  $("savedArea").setAttribute("d", areaPath);

  $("originalEndpoint").setAttribute("cx", x(lastOriginal.month));
  $("originalEndpoint").setAttribute("cy", y(lastOriginal.interest));
  $("acceleratedEndpoint").setAttribute("cx", x(lastAccelerated.month));
  $("acceleratedEndpoint").setAttribute("cy", y(lastAccelerated.interest));

  const payoffX = x(lastAccelerated.month);
  const marker = $("payoffMarker");
  marker.setAttribute("x1", payoffX);
  marker.setAttribute("x2", payoffX);
  marker.setAttribute("y1", margin.top);
  marker.setAttribute("y2", height - margin.bottom);

  const labelWidth = 128;
  const labelX = Math.min(width - margin.right - labelWidth, Math.max(margin.left, payoffX - labelWidth / 2));
  $("payoffMarkerLabel").setAttribute("transform", `translate(${labelX} ${margin.top - 8})`);
  $("payoffMarkerYear").textContent = `YEAR ${(lastAccelerated.month / 12).toFixed(1)}`;

  const savings = lastOriginal.interest - lastAccelerated.interest;
  const annotation = $("savingsAnnotation");
  if (savings > 1 && lastAccelerated.month < lastOriginal.month) {
    const targetMonth = lastAccelerated.month + (lastOriginal.month - lastAccelerated.month) * 0.58;
    const targetX = x(targetMonth);
    const targetY = (y(interestAtMonth(originalSeries, targetMonth)) + y(lastAccelerated.interest)) / 2;
    const cardWidth = 190;
    const cardHeight = 76;
    const leftOfFinish = payoffX - cardWidth - 18;
    const cardX = leftOfFinish >= margin.left
      ? leftOfFinish
      : Math.min(width - margin.right - cardWidth, payoffX + 18);
    const cardY = Math.max(margin.top + 52, Math.min(height - margin.bottom - cardHeight - 8, targetY - cardHeight / 2));
    const leaderEndX = cardX > targetX ? cardX : cardX + cardWidth;
    const leaderEndY = cardY + cardHeight / 2;

    annotation.style.opacity = "1";
    $("savingsTarget").setAttribute("cx", targetX);
    $("savingsTarget").setAttribute("cy", targetY);
    $("savingsLeader").setAttribute("x1", targetX);
    $("savingsLeader").setAttribute("y1", targetY);
    $("savingsLeader").setAttribute("x2", leaderEndX);
    $("savingsLeader").setAttribute("y2", leaderEndY);
    $("savingsCard").setAttribute("transform", `translate(${cardX} ${cardY})`);
  } else {
    annotation.style.opacity = "0";
  }

  const grid = $("chartGrid");
  const labels = $("chartLabels");
  grid.innerHTML = "";
  labels.innerHTML = "";

  for (let step = 0; step <= 4; step++) {
    const gridY = margin.top + plotHeight * step / 4;
    const amount = maxInterest * (1 - step / 4);
    grid.insertAdjacentHTML("beforeend", `<line x1="${margin.left}" y1="${gridY}" x2="${width - margin.right}" y2="${gridY}"></line>`);
    labels.insertAdjacentHTML("beforeend", `<text x="${margin.left - 12}" y="${gridY + 4}" text-anchor="end">$${Math.round(amount / 1000)}k</text>`);
  }

  const totalYears = maxMonths / 12;
  for (let step = 0; step <= 5; step++) {
    const gridX = margin.left + plotWidth * step / 5;
    const year = Math.round(totalYears * step / 5);
    grid.insertAdjacentHTML("beforeend", `<line x1="${gridX}" y1="${margin.top}" x2="${gridX}" y2="${height - margin.bottom}"></line>`);
    labels.insertAdjacentHTML("beforeend", `<text x="${gridX}" y="${height - 15}" text-anchor="middle">${year === 0 ? "Today" : `Year ${year}`}</text>`);
  }
}

function update() {
  const initialLoan = Math.max(1000, Number(inputs.initialLoan.value) || 0);
  const principal = Math.max(1000, Number(inputs.principal.value) || 0);
  const rate = Math.max(0, Number(inputs.rate.value) || 0);
  const termYears = Math.max(1, Number(inputs.originalTerm.value) || 1);
  const annualPropertyTax = Math.max(0, Number(inputs.propertyTax.value) || 0);
  const annualInsurance = Math.max(0, Number(inputs.insurance.value) || 0);
  const loanTermMonths = Math.round(termYears * 12);
  const extra = Number(inputs.extra.value);
  const monthlyPropertyTax = annualPropertyTax / 12;
  const monthlyInsurance = annualInsurance / 12;
  const monthlyEscrow = monthlyPropertyTax + monthlyInsurance;
  const base = monthlyPayment(initialLoan, rate, loanTermMonths);
  const currentMonthInterest = principal * rate / 100 / 12;
  const currentMonthPrincipal = Math.max(0, base - currentMonthInterest);
  const baseline = amortize(principal, rate, base, 0);
  const accelerated = amortize(principal, rate, base, extra);
  const originalInterestSeries = interestSeries(principal, rate, base, 0);
  const acceleratedInterestSeries = interestSeries(principal, rate, base, extra);

  const savedMonths = Math.max(0, baseline.months - accelerated.months);
  const savedYears = savedMonths / 12;
  const newYears = accelerated.months / 12;
  const interestSaved = Math.max(0, baseline.interest - accelerated.interest);

  $("extraOutput").textContent = formatMoney.format(extra);
  $("extraSummary").textContent = `$${formatMoney.format(extra)}`;
  $("basePayment").textContent = `$${formatMoney.format(base)}`;
  $("piBreakdown").textContent = `($${formatMoney.format(currentMonthPrincipal)} principal + $${formatMoney.format(currentMonthInterest)} interest; ${termYears}-year loan)`;
  $("escrowBreakdown").textContent = `($${formatMoney.format(monthlyPropertyTax)} tax + $${formatMoney.format(monthlyInsurance)} insurance)`;
  $("escrowPayment").textContent = `$${formatMoney.format(monthlyEscrow)}`;
  $("totalPayment").textContent = `$${formatMoney.format(base + monthlyEscrow + extra)}`;
  $("payoffYears").textContent = newYears.toFixed(1);
  $("yearsSaved").textContent = savedYears.toFixed(1);
  $("interestSaved").textContent = formatMoney.format(interestSaved);
  $("plotOriginalTotal").textContent = `$${formatMoney.format(baseline.interest)}`;
  $("plotAcceleratedTotal").textContent = `$${formatMoney.format(accelerated.interest)}`;
  $("chartSavings").textContent = `$${formatMoney.format(interestSaved)}`;
  $("paymentsSkipped").textContent = `That’s ${savedMonths} monthly payments you’ll never have to make.`;
  $("payoffDate").textContent = payoffLabel(accelerated.months);
  $("orbitSaved").textContent = `${savedYears.toFixed(1)} years back`;
  $("originalTermLabel").textContent = `${(baseline.months / 12).toFixed(1)} years`;
  $("newTermLabel").textContent = `${newYears.toFixed(1)} years`;

  const sliderProgress = (extra - Number(inputs.extra.min)) / (Number(inputs.extra.max) - Number(inputs.extra.min)) * 100;
  inputs.extra.style.setProperty("--value", `${sliderProgress}%`);

  const circumference = 2 * Math.PI * 145;
  const remainingRatio = Math.min(1, accelerated.months / baseline.months);
  $("orbitProgress").style.strokeDasharray = circumference;
  $("orbitProgress").style.strokeDashoffset = circumference * (1 - remainingRatio);

  document.querySelectorAll(".quick-picks button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.extra) === extra);
  });

  const activeCells = Math.round(Math.min(96, savedMonths / Math.max(1, baseline.months) * 180));
  document.querySelectorAll("#calendar i").forEach((cell, index) => {
    cell.classList.toggle("on", index < activeCells);
  });

  buildTimeline(baseline.months / 12, newYears);
  drawInterestChart(originalInterestSeries, acceleratedInterestSeries);
}

restoreInputs();
buildDecorations();
update();
saveInputs();

Object.values(inputs).forEach((input) => {
  const saveAndUpdate = () => {
    saveInputs();
    update();
  };
  input.addEventListener("input", saveAndUpdate);
  input.addEventListener("change", saveAndUpdate);
});

document.querySelectorAll(".quick-picks button").forEach((button) => {
  button.addEventListener("click", () => {
    inputs.extra.value = button.dataset.extra;
    saveInputs();
    update();
  });
});

window.addEventListener("beforeunload", saveInputs);
$("mortgageForm").addEventListener("submit", (event) => event.preventDefault());
