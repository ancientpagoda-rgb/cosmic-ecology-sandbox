const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function hash32(input) {
  let hash = 2166136261 >>> 0;
  const text = String(input);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitHash(input) {
  return hash32(input) / 0x100000000;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortId(id) {
  const text = String(id || '');
  const match = text.match(/:(p|h):(\d+)$/);
  return match ? `${match[1].toUpperCase()}${match[2]}` : text;
}

function occupationLabel(value) {
  return value ? String(value).replaceAll('-', ' ') : 'dependent';
}

function householdPoint(id) {
  // The position is deterministic presentation state only. It is deliberately
  // not written back into the civilization model as archaeological geography.
  const column = hash32(`${id}|column`) % 12;
  const row = hash32(`${id}|row`) % 10;
  const jitterX = (unitHash(`${id}|jx`) - 0.5) * 0.045;
  const jitterY = (unitHash(`${id}|jy`) - 0.5) * 0.050;
  return {
    x: clamp(0.075 + (column + 0.5) / 12 * 0.85 + jitterX, 0.06, 0.94),
    y: clamp(0.10 + (row + 0.5) / 10 * 0.80 + jitterY, 0.08, 0.92),
  };
}

function memberPoint(id, index, count) {
  const angle = (Math.PI * 2 * index) / Math.max(1, count) + unitHash(`${id}|angle`) * 0.35;
  const ring = count <= 4 ? 0.22 : 0.29;
  return {
    x: 0.5 + Math.cos(angle) * ring,
    y: 0.53 + Math.sin(angle) * ring,
  };
}

export function createSumerianSocialExplorer({
  simulation,
  canvas = document.getElementById('sumerSocialCanvas'),
  breadcrumb = document.getElementById('sumerExplorerBreadcrumb'),
  detail = document.getElementById('sumerExplorerDetail'),
  backButton = document.getElementById('sumerExplorerBack'),
} = {}) {
  if (!simulation || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Sumer social explorer requires a simulation and #sumerSocialCanvas.');
  }

  const context = canvas.getContext('2d');
  let cityId = 'uruk';
  let level = 'city';
  let householdId = null;
  let personId = null;
  let cityDetail = null;
  let observerResult = null;
  let destroyed = false;

  function citySnapshot() {
    return simulation.snapshot().cities.find(city => city.id === cityId) || null;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(280, Math.round(rect.width * ratio));
    const height = Math.max(220, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function currentHousehold() {
    return cityDetail?.households?.find(household => household.id === householdId) || null;
  }

  function currentPerson() {
    return cityDetail?.people?.find(person => person.id === personId) || null;
  }

  function memberRows(household) {
    if (!household) return [];
    const byId = new Map(cityDetail.people.map(person => [person.id, person]));
    return household.memberIds.map(id => byId.get(id)).filter(Boolean);
  }

  function validateSelection() {
    if (level === 'city') {
      householdId = null;
      personId = null;
      return;
    }
    const household = currentHousehold();
    if (!household) {
      level = 'city';
      householdId = null;
      personId = null;
      observerResult = null;
      return;
    }
    if (level === 'person' && !currentPerson()) {
      level = 'household';
      personId = null;
      observerResult = simulation.observeHousehold(household.id, 'sumer-social-explorer');
    }
  }

  function drawBackground(width, height) {
    context.fillStyle = '#ccb78f';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(91, 68, 44, 0.20)';
    context.lineWidth = Math.max(1, width * 0.0015);
    for (let column = 1; column < 6; column += 1) {
      const x = width * column / 6;
      context.beginPath();
      context.moveTo(x, height * 0.05);
      context.lineTo(x, height * 0.95);
      context.stroke();
    }
    for (let row = 1; row < 5; row += 1) {
      const y = height * row / 5;
      context.beginPath();
      context.moveTo(width * 0.04, y);
      context.lineTo(width * 0.96, y);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(width * 0.08, height * 0.16);
    context.bezierCurveTo(width * 0.34, height * 0.24, width * 0.61, height * 0.72, width * 0.92, height * 0.80);
    context.lineWidth = Math.max(4, width * 0.012);
    context.strokeStyle = 'rgba(49, 121, 150, 0.58)';
    context.stroke();
  }

  function drawCity() {
    const width = canvas.width;
    const height = canvas.height;
    drawBackground(width, height);

    context.fillStyle = 'rgba(107, 71, 38, 0.70)';
    context.fillRect(width * 0.455, height * 0.40, width * 0.09, height * 0.13);
    context.fillStyle = 'rgba(245, 232, 197, 0.92)';
    context.font = `${Math.max(10, Math.round(width * 0.025))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('schematic core', width * 0.5, height * 0.465);

    for (const household of cityDetail.households) {
      const point = householdPoint(household.id);
      const members = household.memberIds.length;
      const marker = clamp(1.6 + Math.sqrt(members) * 0.9, 2.2, 5.2) * Math.min(2, window.devicePixelRatio || 1);
      context.fillStyle = '#6c4528';
      context.globalAlpha = 0.77;
      context.fillRect(point.x * width - marker / 2, point.y * height - marker / 2, marker, marker);
    }
    context.globalAlpha = 1;

    context.fillStyle = 'rgba(35, 25, 16, 0.78)';
    context.fillRect(8, 8, Math.min(width - 16, width * 0.72), Math.max(30, height * 0.11));
    context.fillStyle = '#f5ead5';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.font = `${Math.max(11, Math.round(width * 0.027))}px ui-monospace, monospace`;
    context.fillText(`${cityDetail.households.length.toLocaleString()} actual households · click a compound`, 16, 8 + Math.max(30, height * 0.11) / 2);
  }

  function drawHousehold() {
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = '#bda77e';
    context.fillRect(0, 0, width, height);

    const marginX = width * 0.13;
    const marginY = height * 0.12;
    context.fillStyle = '#8b6641';
    context.fillRect(marginX, marginY, width - marginX * 2, height - marginY * 2);
    context.fillStyle = '#d8c49a';
    context.fillRect(width * 0.30, height * 0.29, width * 0.40, height * 0.44);
    context.fillStyle = '#6f4b2e';
    context.fillRect(width * 0.14, height * 0.18, width * 0.14, height * 0.25);
    context.fillRect(width * 0.72, height * 0.18, width * 0.14, height * 0.25);
    context.fillRect(width * 0.14, height * 0.57, width * 0.14, height * 0.25);
    context.fillRect(width * 0.72, height * 0.57, width * 0.14, height * 0.25);

    const household = currentHousehold();
    const members = memberRows(household);
    const selected = currentPerson();
    const positions = new Map();
    members.forEach((person, index) => positions.set(person.id, memberPoint(person.id, index, members.length)));

    if (selected?.socialTies?.length) {
      const selectedPoint = positions.get(selected.id);
      if (selectedPoint) {
        context.strokeStyle = 'rgba(78, 61, 45, 0.42)';
        context.lineWidth = Math.max(1, width * 0.003);
        for (const tieId of selected.socialTies) {
          const tiePoint = positions.get(tieId);
          if (!tiePoint) continue;
          context.beginPath();
          context.moveTo(selectedPoint.x * width, selectedPoint.y * height);
          context.lineTo(tiePoint.x * width, tiePoint.y * height);
          context.stroke();
        }
      }
    }

    members.forEach((person, index) => {
      const point = positions.get(person.id);
      const selectedNow = person.id === personId;
      const radius = (selectedNow ? 10 : 7) * Math.min(2, window.devicePixelRatio || 1);
      context.beginPath();
      context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
      context.fillStyle = selectedNow ? '#4c2519' : person.age < 15 ? '#cba966' : '#684a31';
      context.fill();
      context.lineWidth = selectedNow ? Math.max(2, radius * 0.28) : Math.max(1, radius * 0.15);
      context.strokeStyle = selectedNow ? '#f4d68d' : 'rgba(255,255,255,0.70)';
      context.stroke();
      context.fillStyle = '#2c1d13';
      context.font = `${Math.max(9, Math.round(width * 0.020))}px ui-monospace, monospace`;
      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.fillText(shortId(person.id), point.x * width, point.y * height + radius + 3);
    });

    context.fillStyle = 'rgba(35, 25, 16, 0.82)';
    context.fillRect(8, 8, Math.min(width - 16, width * 0.72), Math.max(30, height * 0.11));
    context.fillStyle = '#f5ead5';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.font = `${Math.max(11, Math.round(width * 0.027))}px ui-monospace, monospace`;
    context.fillText(`${members.length} actual living members · click a person`, 16, 8 + Math.max(30, height * 0.11) / 2);
  }

  function draw() {
    if (destroyed || !cityDetail) return;
    resizeCanvas();
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (level === 'city') drawCity();
    else drawHousehold();
  }

  function renderDetail() {
    const city = citySnapshot();
    const cityName = city?.name || cityId;
    if (breadcrumb) {
      const parts = [cityName];
      if (level !== 'city' && householdId) parts.push(shortId(householdId));
      if (level === 'person' && personId) parts.push(shortId(personId));
      breadcrumb.textContent = parts.join('  ›  ');
    }
    if (backButton) backButton.disabled = level === 'city';
    if (!detail) return;

    if (level === 'city') {
      const occupations = cityDetail.occupations || {};
      detail.innerHTML = `<strong>${escapeHtml(cityName)} social fabric</strong><br>`
        + `${cityDetail.population.toLocaleString()} living people · ${cityDetail.households.length.toLocaleString()} households · ${cityDetail.adults.toLocaleString()} adults<br>`
        + `farmers ${(occupations.farmer || 0).toLocaleString()} · canal workers ${(occupations['canal-worker'] || 0).toLocaleString()} · merchants ${(occupations.merchant || 0).toLocaleString()} · scribes ${(occupations.scribe || 0).toLocaleString()}<br>`
        + `<span class="explorer-note">Every household record is rendered above. Compound positions and streets are deterministic schematic layout only; click any compound to resolve the real household through the multiscale kernel.</span>`;
      return;
    }

    const household = currentHousehold();
    const members = memberRows(household);
    if (!household) {
      detail.textContent = 'Household no longer exists in this city.';
      return;
    }

    if (level === 'household') {
      detail.innerHTML = `<strong>Household ${escapeHtml(shortId(household.id))}</strong> · kin group ${escapeHtml(household.kinGroup)}<br>`
        + `${members.length} living members · founded model year ${household.foundedYearIndex}<br>`
        + `<div class="explorer-members">${members.map(person => `<button type="button" data-person-id="${escapeHtml(person.id)}">${escapeHtml(shortId(person.id))} · age ${person.age} · ${escapeHtml(occupationLabel(person.occupation))}</button>`).join('')}</div>`
        + `<span class="explorer-note">All living members of this household are shown; no household member is sampled or hidden.</span>`;
      for (const button of detail.querySelectorAll('[data-person-id]')) {
        button.addEventListener('click', () => openPerson(button.dataset.personId));
      }
      return;
    }

    const person = currentPerson();
    if (!person) {
      detail.textContent = 'Person is no longer living in this household.';
      return;
    }
    const needs = person.needs || {};
    const needLine = Object.entries(needs)
      .map(([name, value]) => `${escapeHtml(name.replaceAll(/([A-Z])/g, ' $1').toLowerCase())} ${(clamp(Number(value) || 0, 0, 1) * 100).toFixed(0)}%`)
      .join(' · ');
    const parentText = person.parentIds.length ? person.parentIds.map(shortId).join(', ') : 'none recorded';
    const ties = person.socialTies || [];
    detail.innerHTML = `<strong>Person ${escapeHtml(shortId(person.id))}</strong> · age ${person.age} · ${escapeHtml(person.sex)} · ${escapeHtml(occupationLabel(person.occupation))}<br>`
      + `status index ${(person.status * 100).toFixed(0)}% · household ${escapeHtml(shortId(person.householdId))} · kin ${escapeHtml(person.kinGroup)}<br>`
      + `<strong>Needs:</strong> ${needLine}<br>`
      + `<strong>Parents:</strong> ${escapeHtml(parentText)}<br>`
      + `<strong>Direct social ties:</strong> ${ties.length ? escapeHtml(ties.map(shortId).join(', ')) : 'none recorded'}<br>`
      + `<span class="explorer-note">Needs are current model indices derived from city and household state, not historical psychological measurements.</span>`;
  }

  function refresh() {
    if (destroyed) return;
    cityDetail = simulation.getCitySocialDetail(cityId);
    validateSelection();
    renderDetail();
    draw();
  }

  function setCity(nextCityId) {
    const requested = String(nextCityId || cityId);
    const changed = requested !== cityId;
    cityId = requested;
    if (changed) {
      level = 'city';
      householdId = null;
      personId = null;
      observerResult = null;
    }
    refresh();
    return getState();
  }

  function openHousehold(nextHouseholdId) {
    if (!cityDetail) refresh();
    const household = cityDetail.households.find(item => item.id === nextHouseholdId);
    if (!household) throw new Error(`Household ${nextHouseholdId} is not living in ${cityId}.`);
    householdId = household.id;
    personId = null;
    level = 'household';
    observerResult = simulation.observeHousehold(household.id, 'sumer-social-explorer');
    renderDetail();
    draw();
    return getState();
  }

  function openPerson(nextPersonId) {
    if (!cityDetail) refresh();
    const person = cityDetail.people.find(item => item.id === nextPersonId);
    if (!person) throw new Error(`Person ${nextPersonId} is not living in ${cityId}.`);
    householdId = person.householdId;
    personId = person.id;
    level = 'person';
    observerResult = simulation.observePerson(person.id, 'sumer-social-explorer');
    renderDetail();
    draw();
    return getState();
  }

  function back() {
    if (level === 'person') {
      level = 'household';
      personId = null;
      const household = currentHousehold();
      observerResult = household ? simulation.observeHousehold(household.id, 'sumer-social-explorer') : null;
    } else if (level === 'household') {
      level = 'city';
      householdId = null;
      personId = null;
      observerResult = null;
    }
    renderDetail();
    draw();
    return getState();
  }

  function selectFromCanvas(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = (event.clientY - rect.top) / Math.max(1, rect.height);
    if (level === 'city') {
      let best = null;
      let bestDistance = Infinity;
      for (const household of cityDetail.households) {
        const point = householdPoint(household.id);
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < bestDistance) {
          best = household;
          bestDistance = distance;
        }
      }
      if (best && bestDistance < 0.045) openHousehold(best.id);
      return;
    }

    const members = memberRows(currentHousehold());
    let best = null;
    let bestDistance = Infinity;
    members.forEach((person, index) => {
      const point = memberPoint(person.id, index, members.length);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        best = person;
        bestDistance = distance;
      }
    });
    if (best && bestDistance < 0.08) openPerson(best.id);
  }

  function getState() {
    const household = currentHousehold();
    return {
      level,
      cityId,
      householdId,
      personId,
      renderedHouseholds: cityDetail?.households?.length || 0,
      renderedPeople: household ? household.memberIds.length : 0,
      observerResolvedNodeId: observerResult?.resolvedNodeId || null,
    };
  }

  backButton?.addEventListener('click', back);
  canvas.addEventListener('click', selectFromCanvas);
  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  refresh();

  return {
    setCity,
    refresh,
    openHousehold,
    openPerson,
    back,
    getState,
    destroy() {
      destroyed = true;
      backButton?.removeEventListener('click', back);
      canvas.removeEventListener('click', selectFromCanvas);
      window.removeEventListener('resize', onResize);
    },
  };
}
