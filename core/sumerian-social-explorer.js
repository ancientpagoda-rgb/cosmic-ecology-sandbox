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
  const person = text.match(/:p:(\d+)$/);
  if (person) return `P${person[1]}`;
  const household = text.match(/:h:(\d+)/);
  if (household) return `H${household[1]}`;
  const ward = text.match(/:ward:(\d+)/);
  if (ward) return `W${ward[1]}`;
  const corridor = text.match(/:corridor:(\d+)$/);
  if (corridor) return `C${corridor[1]}`;
  return text;
}

function occupationLabel(value) {
  return value ? String(value).replaceAll('-', ' ') : 'dependent';
}

function memberPoint(id, index, count) {
  const angle = (Math.PI * 2 * index) / Math.max(1, count) + unitHash(`${id}|angle`) * 0.35;
  const ring = count <= 4 ? 0.22 : 0.29;
  return { x: 0.5 + Math.cos(angle) * ring, y: 0.53 + Math.sin(angle) * ring };
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const denominator = dx * dx + dy * dy;
  if (denominator <= 1e-9) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / denominator, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function wardColor(type) {
  switch (type) {
    case 'temple': return '#9a7441';
    case 'market': return '#8b5d38';
    case 'canal': return '#6a7e70';
    case 'craft': return '#80604b';
    case 'gate': return '#6f5546';
    default: return '#8a7354';
  }
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
  let wardId = null;
  let corridorId = null;
  let householdId = null;
  let personId = null;
  let socialDetail = null;
  let urbanDetail = null;
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

  function currentWard() {
    return urbanDetail?.wards?.find(ward => ward.id === wardId) || null;
  }

  function currentCorridor() {
    return urbanDetail?.corridors?.find(corridor => corridor.id === corridorId) || null;
  }

  function currentCompound() {
    return urbanDetail?.compounds?.find(compound => compound.householdId === householdId) || null;
  }

  function currentHousehold() {
    return socialDetail?.households?.find(household => household.id === householdId) || null;
  }

  function currentPerson() {
    return socialDetail?.people?.find(person => person.id === personId) || null;
  }

  function memberRows(household) {
    if (!household) return [];
    const byId = new Map(socialDetail.people.map(person => [person.id, person]));
    return household.memberIds.map(id => byId.get(id)).filter(Boolean);
  }

  function validateSelection() {
    if (level === 'city') return;
    const ward = currentWard();
    if (!ward) {
      level = 'city';
      wardId = corridorId = householdId = personId = null;
      observerResult = null;
      return;
    }
    if (level === 'ward') return;
    const corridor = currentCorridor();
    if (!corridor || corridor.wardId !== ward.id) {
      level = 'ward';
      corridorId = householdId = personId = null;
      observerResult = simulation.observeWard(ward.id, 'sumer-social-explorer');
      return;
    }
    if (level === 'corridor') return;
    const compound = currentCompound();
    const household = currentHousehold();
    if (!compound || !household || compound.corridorId !== corridor.id) {
      level = 'corridor';
      householdId = personId = null;
      observerResult = simulation.observeCorridor(corridor.id, 'sumer-social-explorer');
      return;
    }
    if (level === 'compound' || level === 'household') return;
    if (level === 'person' && !currentPerson()) {
      level = 'household';
      personId = null;
      observerResult = simulation.observeHousehold(household.id, 'sumer-social-explorer');
    }
  }

  function drawBase(width, height) {
    context.fillStyle = '#cbb58b';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(73, 58, 40, 0.13)';
    context.lineWidth = Math.max(1, width * 0.0014);
    for (let x = 1; x < 8; x += 1) {
      context.beginPath();
      context.moveTo(width * x / 8, 0);
      context.lineTo(width * x / 8, height);
      context.stroke();
    }
    for (let y = 1; y < 6; y += 1) {
      context.beginPath();
      context.moveTo(0, height * y / 6);
      context.lineTo(width, height * y / 6);
      context.stroke();
    }
  }

  function drawHeader(text) {
    const width = canvas.width;
    const height = canvas.height;
    const boxHeight = Math.max(31, height * 0.11);
    context.fillStyle = 'rgba(35, 25, 16, 0.82)';
    context.fillRect(8, 8, Math.min(width - 16, width * 0.82), boxHeight);
    context.fillStyle = '#f5ead5';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.font = `${Math.max(10, Math.round(width * 0.025))}px ui-monospace, monospace`;
    context.fillText(text, 16, 8 + boxHeight / 2);
  }

  function drawCity() {
    const width = canvas.width;
    const height = canvas.height;
    drawBase(width, height);
    context.beginPath();
    context.moveTo(width * 0.10, height * 0.19);
    context.bezierCurveTo(width * 0.35, height * 0.28, width * 0.61, height * 0.70, width * 0.92, height * 0.81);
    context.lineWidth = Math.max(4, width * 0.012);
    context.strokeStyle = 'rgba(49, 121, 150, 0.58)';
    context.stroke();

    for (const ward of urbanDetail.wards) {
      const radius = Math.max(10, ward.radius * Math.min(width, height));
      context.beginPath();
      context.arc(ward.x * width, ward.y * height, radius, 0, Math.PI * 2);
      context.fillStyle = wardColor(ward.type);
      context.globalAlpha = 0.68;
      context.fill();
      context.globalAlpha = 1;
      context.lineWidth = Math.max(1, radius * 0.08);
      context.strokeStyle = 'rgba(255,245,218,0.72)';
      context.stroke();
      context.fillStyle = '#2c1d13';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `${Math.max(8, Math.round(width * 0.016))}px ui-monospace, monospace`;
      context.fillText(`${shortId(ward.id)} ${ward.type}`, ward.x * width, ward.y * height - 3);
      context.font = `${Math.max(7, Math.round(width * 0.013))}px ui-monospace, monospace`;
      context.fillText(`${ward.households} hh`, ward.x * width, ward.y * height + 11);
    }
    drawHeader(`${urbanDetail.wards.length} persistent wards · click a ward`);
  }

  function drawWard() {
    const width = canvas.width;
    const height = canvas.height;
    drawBase(width, height);
    const ward = currentWard();
    const corridorRows = urbanDetail.corridors.filter(corridor => corridor.wardId === ward.id);
    const corridorIds = new Set(corridorRows.map(corridor => corridor.id));
    const compoundRows = urbanDetail.compounds.filter(compound => corridorIds.has(compound.corridorId));

    for (const corridor of corridorRows) {
      context.beginPath();
      context.moveTo(corridor.x1 * width, corridor.y1 * height);
      context.lineTo(corridor.x2 * width, corridor.y2 * height);
      context.lineWidth = corridor.kind === 'canal' ? Math.max(6, width * 0.014) : Math.max(4, width * 0.008);
      context.strokeStyle = corridor.kind === 'canal' ? 'rgba(44,126,158,0.72)' : 'rgba(87,59,37,0.66)';
      context.stroke();
    }
    for (const compound of compoundRows) {
      const size = Math.max(3, width * 0.007);
      context.fillStyle = '#6d4528';
      context.fillRect(compound.x * width - size / 2, compound.y * height - size / 2, size, size);
    }
    drawHeader(`${ward.type} ward · ${corridorRows.length} corridors · ${compoundRows.length} compounds · click a corridor`);
  }

  function drawCorridor() {
    const width = canvas.width;
    const height = canvas.height;
    drawBase(width, height);
    const corridor = currentCorridor();
    const compoundRows = urbanDetail.compounds.filter(compound => compound.corridorId === corridor.id);
    context.beginPath();
    context.moveTo(corridor.x1 * width, corridor.y1 * height);
    context.lineTo(corridor.x2 * width, corridor.y2 * height);
    context.lineWidth = corridor.kind === 'canal' ? Math.max(10, width * 0.022) : Math.max(7, width * 0.014);
    context.strokeStyle = corridor.kind === 'canal' ? 'rgba(44,126,158,0.70)' : 'rgba(87,59,37,0.68)';
    context.stroke();
    for (const compound of compoundRows) {
      const household = socialDetail.households.find(item => item.id === compound.householdId);
      const members = household?.memberIds?.length || 0;
      const size = clamp(5 + Math.sqrt(members) * 2.0, 7, 15) * Math.min(2, window.devicePixelRatio || 1);
      context.fillStyle = '#72482b';
      context.fillRect(compound.x * width - size / 2, compound.y * height - size / 2, size, size);
      context.strokeStyle = 'rgba(255,243,211,0.75)';
      context.strokeRect(compound.x * width - size / 2, compound.y * height - size / 2, size, size);
    }
    drawHeader(`${corridor.kind} ${shortId(corridor.id)} · ${compoundRows.length} actual compounds · click a compound`);
  }

  function drawCompound() {
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = '#bda77e';
    context.fillRect(0, 0, width, height);
    const compound = currentCompound();
    context.fillStyle = '#855f3e';
    context.fillRect(width * 0.12, height * 0.12, width * 0.76, height * 0.76);
    context.fillStyle = '#d7c39a';
    context.fillRect(width * 0.30, height * 0.29, width * 0.40, height * 0.43);
    context.fillStyle = '#66452d';
    context.fillRect(width * 0.13, height * 0.17, width * 0.14, height * 0.27);
    context.fillRect(width * 0.73, height * 0.17, width * 0.14, height * 0.27);
    context.fillRect(width * 0.13, height * 0.56, width * 0.14, height * 0.27);
    context.fillRect(width * 0.73, height * 0.56, width * 0.14, height * 0.27);
    context.fillStyle = '#2b1c13';
    context.textAlign = 'center';
    context.font = `${Math.max(13, Math.round(width * 0.032))}px ui-monospace, monospace`;
    context.fillText(`compound of ${shortId(compound.householdId)}`, width * 0.5, height * 0.50);
    drawHeader(`persistent compound · click center or use Enter household`);
  }

  function drawHousehold() {
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = '#bda77e';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#8b6641';
    context.fillRect(width * 0.13, height * 0.12, width * 0.74, height * 0.76);
    context.fillStyle = '#d8c49a';
    context.fillRect(width * 0.30, height * 0.29, width * 0.40, height * 0.44);

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

    for (const [index, person] of members.entries()) {
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
    }
    drawHeader(`${members.length} actual living household members · click a person`);
  }

  function draw() {
    if (destroyed || !socialDetail || !urbanDetail) return;
    resizeCanvas();
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (level === 'city') drawCity();
    else if (level === 'ward') drawWard();
    else if (level === 'corridor') drawCorridor();
    else if (level === 'compound') drawCompound();
    else drawHousehold();
  }

  function renderDetail() {
    const city = citySnapshot();
    const cityName = city?.name || cityId;
    if (breadcrumb) {
      const parts = [cityName];
      if (wardId) parts.push(shortId(wardId));
      if (corridorId) parts.push(shortId(corridorId));
      if (householdId && (level === 'compound' || level === 'household' || level === 'person')) parts.push(`compound ${shortId(householdId)}`);
      if (householdId && (level === 'household' || level === 'person')) parts.push(`household ${shortId(householdId)}`);
      if (personId) parts.push(shortId(personId));
      breadcrumb.textContent = parts.join('  ›  ');
    }
    if (backButton) backButton.disabled = level === 'city';
    if (!detail) return;

    if (level === 'city') {
      const occupations = socialDetail.occupations || {};
      detail.innerHTML = `<strong>${escapeHtml(cityName)} urban society</strong><br>`
        + `${socialDetail.population.toLocaleString()} people · ${urbanDetail.wards.length.toLocaleString()} wards · ${urbanDetail.corridors.length.toLocaleString()} corridors · ${urbanDetail.compounds.length.toLocaleString()} compounds<br>`
        + `farmers ${(occupations.farmer || 0).toLocaleString()} · canal workers ${(occupations['canal-worker'] || 0).toLocaleString()} · merchants ${(occupations.merchant || 0).toLocaleString()} · scribes ${(occupations.scribe || 0).toLocaleString()}<br>`
        + `<span class="explorer-note">Wards, corridor membership and household compounds are persistent model state. Geometry is schematic, but household placement is causal and survives time advancement.</span>`;
      return;
    }

    const ward = currentWard();
    if (level === 'ward') {
      detail.innerHTML = `<strong>${escapeHtml(shortId(ward.id))} · ${escapeHtml(ward.type)} ward</strong><br>`
        + `${ward.population.toLocaleString()} people · ${ward.households.toLocaleString()} households · density ${(ward.density * 100).toFixed(0)}% of target<br>`
        + `canal ${(ward.canalAccess * 100).toFixed(0)}% · market ${(ward.marketAccess * 100).toFixed(0)}% · institutions ${(ward.institutionalAccess * 100).toFixed(0)}% · security ${(ward.security * 100).toFixed(0)}% · food ${(ward.foodAccess * 100).toFixed(0)}%<br>`
        + `<span class="explorer-note">Click a street/canal corridor. New wards open under household pressure; there is no hard ward cap.</span>`;
      return;
    }

    const corridor = currentCorridor();
    if (level === 'corridor') {
      const count = urbanDetail.compounds.filter(compound => compound.corridorId === corridor.id).length;
      detail.innerHTML = `<strong>${escapeHtml(shortId(corridor.id))} · ${escapeHtml(corridor.kind)}</strong><br>`
        + `${count.toLocaleString()} household compounds front this modeled corridor.<br>`
        + `<span class="explorer-note">Click a compound. Every compound on this corridor is rendered; none are sampled away.</span>`;
      return;
    }

    const compound = currentCompound();
    const household = currentHousehold();
    const members = memberRows(household);
    if (!compound || !household) {
      detail.textContent = 'This compound or household no longer exists in the selected city.';
      return;
    }

    if (level === 'compound') {
      detail.innerHTML = `<strong>Compound ${escapeHtml(shortId(household.id))}</strong><br>`
        + `${members.length} living occupants · frontage ${(compound.frontage * 100).toFixed(0)}% · ward ${escapeHtml(shortId(compound.wardId))} · corridor ${escapeHtml(shortId(compound.corridorId))}<br>`
        + `<button type="button" data-enter-household="${escapeHtml(household.id)}">Enter household</button><br>`
        + `<span class="explorer-note">Compound identity and assignment are model state; building geometry is schematic rather than an archaeological floor plan.</span>`;
      detail.querySelector('[data-enter-household]')?.addEventListener('click', () => openHousehold(household.id));
      return;
    }

    if (level === 'household') {
      detail.innerHTML = `<strong>Household ${escapeHtml(shortId(household.id))}</strong> · kin group ${escapeHtml(household.kinGroup)}<br>`
        + `${members.length} living members · founded model year ${household.foundedYearIndex}<br>`
        + `<div class="explorer-members">${members.map(person => `<button type="button" data-person-id="${escapeHtml(person.id)}">${escapeHtml(shortId(person.id))} · age ${person.age} · ${escapeHtml(occupationLabel(person.occupation))}</button>`).join('')}</div>`
        + `<span class="explorer-note">Every living household member is shown; no person is hidden by a display cap.</span>`;
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
    const parents = person.parentIds.length ? person.parentIds.map(shortId).join(', ') : 'none recorded';
    const ties = person.socialTies || [];
    detail.innerHTML = `<strong>Person ${escapeHtml(shortId(person.id))}</strong> · age ${person.age} · ${escapeHtml(person.sex)} · ${escapeHtml(occupationLabel(person.occupation))}<br>`
      + `status ${(person.status * 100).toFixed(0)}% · household ${escapeHtml(shortId(person.householdId))} · ${escapeHtml(person.urban?.ward?.type || 'urban')} ward<br>`
      + `<strong>Needs/access:</strong> ${needLine}<br>`
      + `<strong>Parents:</strong> ${escapeHtml(parents)}<br>`
      + `<strong>Direct social ties:</strong> ${ties.length ? escapeHtml(ties.map(shortId).join(', ')) : 'none recorded'}<br>`
      + `<span class="explorer-note">Local ward access now contributes to the person's current model needs. These remain synthetic model indices, not claims about an ancient individual's psychology.</span>`;
  }

  function refresh() {
    if (destroyed) return;
    socialDetail = simulation.getCitySocialDetail(cityId);
    urbanDetail = simulation.getCityUrbanDetail(cityId);
    validateSelection();
    renderDetail();
    draw();
  }

  function setCity(nextCityId) {
    const requested = String(nextCityId || cityId);
    if (requested !== cityId) {
      cityId = requested;
      level = 'city';
      wardId = corridorId = householdId = personId = null;
      observerResult = null;
    }
    refresh();
    return getState();
  }

  function openWard(nextWardId) {
    const ward = urbanDetail.wards.find(item => item.id === nextWardId);
    if (!ward) throw new Error(`Ward ${nextWardId} is not in ${cityId}.`);
    wardId = ward.id;
    corridorId = householdId = personId = null;
    level = 'ward';
    observerResult = simulation.observeWard(ward.id, 'sumer-social-explorer');
    renderDetail();
    draw();
    return getState();
  }

  function openCorridor(nextCorridorId) {
    const corridor = urbanDetail.corridors.find(item => item.id === nextCorridorId);
    if (!corridor) throw new Error(`Corridor ${nextCorridorId} is not in ${cityId}.`);
    wardId = corridor.wardId;
    corridorId = corridor.id;
    householdId = personId = null;
    level = 'corridor';
    observerResult = simulation.observeCorridor(corridor.id, 'sumer-social-explorer');
    renderDetail();
    draw();
    return getState();
  }

  function openCompound(nextHouseholdId) {
    const compound = urbanDetail.compounds.find(item => item.householdId === nextHouseholdId);
    if (!compound) throw new Error(`Compound for ${nextHouseholdId} is not in ${cityId}.`);
    wardId = compound.wardId;
    corridorId = compound.corridorId;
    householdId = compound.householdId;
    personId = null;
    level = 'compound';
    observerResult = simulation.observeCompound(householdId, 'sumer-social-explorer');
    renderDetail();
    draw();
    return getState();
  }

  function openHousehold(nextHouseholdId) {
    const household = socialDetail.households.find(item => item.id === nextHouseholdId);
    const compound = urbanDetail.compounds.find(item => item.householdId === nextHouseholdId);
    if (!household || !compound) throw new Error(`Household ${nextHouseholdId} is not living in ${cityId}.`);
    wardId = compound.wardId;
    corridorId = compound.corridorId;
    householdId = household.id;
    personId = null;
    level = 'household';
    observerResult = simulation.observeHousehold(household.id, 'sumer-social-explorer');
    renderDetail();
    draw();
    return getState();
  }

  function openPerson(nextPersonId) {
    const person = socialDetail.people.find(item => item.id === nextPersonId);
    if (!person) throw new Error(`Person ${nextPersonId} is not living in ${cityId}.`);
    const compound = urbanDetail.compounds.find(item => item.householdId === person.householdId);
    if (!compound) throw new Error(`Person ${nextPersonId} lacks an urban compound.`);
    wardId = compound.wardId;
    corridorId = compound.corridorId;
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
      observerResult = simulation.observeHousehold(householdId, 'sumer-social-explorer');
    } else if (level === 'household') {
      level = 'compound';
      observerResult = simulation.observeCompound(householdId, 'sumer-social-explorer');
    } else if (level === 'compound') {
      level = 'corridor';
      householdId = personId = null;
      observerResult = simulation.observeCorridor(corridorId, 'sumer-social-explorer');
    } else if (level === 'corridor') {
      level = 'ward';
      corridorId = householdId = personId = null;
      observerResult = simulation.observeWard(wardId, 'sumer-social-explorer');
    } else if (level === 'ward') {
      level = 'city';
      wardId = corridorId = householdId = personId = null;
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
      for (const ward of urbanDetail.wards) {
        const distance = Math.hypot(ward.x - x, ward.y - y);
        if (distance < bestDistance) { best = ward; bestDistance = distance; }
      }
      if (best && bestDistance < Math.max(0.06, best.radius * 1.2)) openWard(best.id);
      return;
    }

    if (level === 'ward') {
      let best = null;
      let bestDistance = Infinity;
      for (const corridor of urbanDetail.corridors.filter(item => item.wardId === wardId)) {
        const distance = pointSegmentDistance(x, y, corridor.x1, corridor.y1, corridor.x2, corridor.y2);
        if (distance < bestDistance) { best = corridor; bestDistance = distance; }
      }
      if (best && bestDistance < 0.065) openCorridor(best.id);
      return;
    }

    if (level === 'corridor') {
      let best = null;
      let bestDistance = Infinity;
      for (const compound of urbanDetail.compounds.filter(item => item.corridorId === corridorId)) {
        const distance = Math.hypot(compound.x - x, compound.y - y);
        if (distance < bestDistance) { best = compound; bestDistance = distance; }
      }
      if (best && bestDistance < 0.055) openCompound(best.householdId);
      return;
    }

    if (level === 'compound') {
      if (Math.hypot(x - 0.5, y - 0.5) < 0.35) openHousehold(householdId);
      return;
    }

    const members = memberRows(currentHousehold());
    let best = null;
    let bestDistance = Infinity;
    members.forEach((person, index) => {
      const point = memberPoint(person.id, index, members.length);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) { best = person; bestDistance = distance; }
    });
    if (best && bestDistance < 0.08) openPerson(best.id);
  }

  function getState() {
    const ward = currentWard();
    const corridor = currentCorridor();
    const household = currentHousehold();
    return {
      level,
      cityId,
      wardId,
      corridorId,
      householdId,
      personId,
      renderedWards: level === 'city' ? urbanDetail?.wards?.length || 0 : 0,
      renderedCorridors: level === 'ward' && ward ? urbanDetail.corridors.filter(item => item.wardId === ward.id).length : 0,
      renderedCompounds: level === 'corridor' && corridor ? urbanDetail.compounds.filter(item => item.corridorId === corridor.id).length : 0,
      renderedPeople: level === 'household' || level === 'person' ? household?.memberIds?.length || 0 : 0,
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
    openWard,
    openCorridor,
    openCompound,
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
