// Globális változók
let map;
let currentMode = 'route';
let routeWaypoints = [];
let routeMarkers = []; // A kék pontok jelölőinek tárolója
let routingControl = null;
let avoidZones = [];
let currentAvoidRadius = 500; // alapértelmezett hatótáv méterben
let homeMarker = null;
let isRightPanning = false;
let lastRightPos = null;

// ÚJ: házikó ikon a repo-ban található képből
const homeIcon = L.icon({
    iconUrl: 'ház.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
});

// Zászló ikon a piros zónákhoz
const avoidFlagIcon = L.icon({
    iconUrl: 'zászló.png',
    iconSize: [30, 30],
    iconAnchor: [15, 30]
});

// ÚJ: Egyedi kék pont ikon CSS-ből létrehozva
const routePointIcon = L.divIcon({
    className: 'route-point-icon',
    html: '',
    iconSize: [12, 12],
});

// Térkép inicializálása
map = L.map('map').setView([47.4979, 19.0402], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
}).addTo(map);

// Eseménykezelők
document.getElementById('mode-route').addEventListener('click', () => setMode('route'));
document.getElementById('mode-avoid').addEventListener('click', () => setMode('avoid'));
document.getElementById('mode-home').addEventListener('click', () => setMode('home'));
document.getElementById('clear-btn').addEventListener('click', clearMap);
document.getElementById('goto-home-btn').addEventListener('click', gotoHome);
document.getElementById('clear-home-btn').addEventListener('click', clearHome);
const suggestBtn = document.getElementById('suggest-btn');
if (suggestBtn) {
    suggestBtn.addEventListener('click', () => {
        const val = parseFloat(document.getElementById('suggest-distance').value);
        if (isNaN(val) || val <= 0) {
            alert('Adj meg érvényes távot!');
            return;
        }
        suggestRoute(val).catch(err => alert(err.message || err));
    });
}

// Piros zóna előnézetéhez szükséges változók
let previewMarker = null;
let previewCircle = null;
let canPlaceAvoid = false;

function setMode(mode) {
    if (currentMode === "avoid") stopAvoidPreview();
    canPlaceAvoid = (mode === "avoid");
    currentMode = mode;
    ['route', 'avoid', 'home'].forEach(m => {
        document.getElementById(`mode-${m}`).classList.toggle('active', m === mode);
    });
    const container = map.getContainer();
    if (mode === 'home') {
        container.style.cursor = "url('ház.png') 20 20, auto";
    } else if (mode === 'avoid') {
        container.style.cursor = "url('zászló.png') 15 30, auto";
        startAvoidPreview();
    } else {
        container.style.cursor = '';
    }
}

map.on('click', function(e) {
    if (currentMode === 'route') {
        addRoutePoint(e.latlng);
    } else if (currentMode === 'avoid') {
        if (canPlaceAvoid) {
            addAvoidFlag(e.latlng);
            removePreview();
            setMode('route');
        }
    } else if (currentMode === 'home') {
        setHomeLocation(e.latlng);
    }
});

function startAvoidPreview() {
    map.scrollWheelZoom.disable();
    map.on('mousemove', onAvoidMouseMove);
    const c = map.getContainer();
    c.addEventListener('wheel', onAvoidWheel);
    c.addEventListener('contextmenu', preventContextMenu);
    c.addEventListener('mousedown', onRightDown);
    c.addEventListener('mousemove', onRightMove);
    c.addEventListener('mouseup', onRightUp);
}

function stopAvoidPreview() {
    map.scrollWheelZoom.enable();
    map.off('mousemove', onAvoidMouseMove);
    const c = map.getContainer();
    c.removeEventListener('wheel', onAvoidWheel);
    c.removeEventListener('contextmenu', preventContextMenu);
    c.removeEventListener('mousedown', onRightDown);
    c.removeEventListener('mousemove', onRightMove);
    c.removeEventListener('mouseup', onRightUp);
    removePreview();
}

function onAvoidMouseMove(e) {
    if (!previewMarker) {
        previewMarker = L.marker(e.latlng, { icon: avoidFlagIcon, interactive: false }).addTo(map);
        previewCircle = L.circle(e.latlng, {
            color: '#ed4245',
            fillColor: '#ed4245',
            fillOpacity: 0.25,
            radius: currentAvoidRadius,
            interactive: false
        }).addTo(map);
    } else {
        previewMarker.setLatLng(e.latlng);
        previewCircle.setLatLng(e.latlng);
    }
    previewCircle.setRadius(currentAvoidRadius);
}

function onAvoidWheel(e) {
    if (currentMode !== 'avoid') return;
    e.preventDefault();
    if (e.deltaY < 0) currentAvoidRadius += 100;
    else currentAvoidRadius -= 100;
    currentAvoidRadius = Math.max(100, Math.min(5000, currentAvoidRadius));
    if (previewCircle) previewCircle.setRadius(currentAvoidRadius);
}

function preventContextMenu(e) {
    e.preventDefault();
}

function onRightDown(e) {
    if (e.button !== 2) return;
    isRightPanning = true;
    lastRightPos = L.point(e.clientX, e.clientY);
    e.preventDefault();
}

function onRightMove(e) {
    if (!isRightPanning) return;
    const current = L.point(e.clientX, e.clientY);
    const diff = current.subtract(lastRightPos);
    map.panBy([-diff.x, -diff.y], { animate: false });
    lastRightPos = current;
    e.preventDefault();
}

function onRightUp(e) {
    if (e.button === 2) {
        isRightPanning = false;
    }
}

function removePreview() {
    if (previewMarker) { map.removeLayer(previewMarker); previewMarker = null; }
    if (previewCircle) { map.removeLayer(previewCircle); previewCircle = null; }
}

// --- Otthon Kezelése ---
function setHomeLocation(latlng) {
    if (homeMarker) map.removeLayer(homeMarker);
    homeMarker = L.marker(latlng, { icon: homeIcon }).addTo(map);
    homeMarker.on('click', closeLoopAtHome); // Eseménykezelő a kör bezárásához
    map.setView(latlng, 16); // Középre helyezzük a térképet a beállított otthonra
    localStorage.setItem('homeLocation', JSON.stringify(latlng));
    setMode('route');
}

function loadHomeLocation() {
    const savedHome = localStorage.getItem('homeLocation');
    if (savedHome) {
        const homeCoords = JSON.parse(savedHome);
        homeMarker = L.marker(homeCoords, { icon: homeIcon }).addTo(map);
        homeMarker.on('click', closeLoopAtHome); // Eseménykezelő a kör bezárásához
        map.setView(homeCoords, 16); // Otthon betöltésekor is fókuszáljunk rá
    }
}

function gotoHome() {
    if (homeMarker) map.setView(homeMarker.getLatLng(), 16);
    else alert("Nincs beállítva otthon helyszín!");
}

function clearHome() {
    if (homeMarker) {
        map.removeLayer(homeMarker);
        homeMarker = null;
        localStorage.removeItem('homeLocation');
        clearMap(); // Töröljük a meglévő útvonalat is, mert már nincs mihez képest
        alert("Otthon helyszín törölve.");
    }
}

// --- ÚJ ÚTVONALTERVEZŐ LOGIKA ---

function addRoutePoint(latlng) {
    // Ha ez az első pont, és van otthon, az otthon lesz a kiindulópont
    if (routeWaypoints.length === 0 && homeMarker) {
        routeWaypoints.push(homeMarker.getLatLng());
    }

    // Új pont hozzáadása a waypoints és a markers listához
    routeWaypoints.push(latlng);
    const newMarker = L.marker(latlng, { icon: routePointIcon }).addTo(map);
    
    // Eseménykezelő a pont törléséhez
    newMarker.on('click', (e) => {
        L.DomEvent.stopPropagation(e); // Megállítja, hogy a map.click is lefusson
        removeRoutePoint(newMarker, latlng);
    });

    routeMarkers.push(newMarker);
    updateRoute();
}

function removeRoutePoint(markerToRemove, latlngToRemove) {
    // Marker és waypoint eltávolítása a listákból
    const markerIndex = routeMarkers.indexOf(markerToRemove);
    if (markerIndex > -1) {
        routeMarkers.splice(markerIndex, 1);
    }
    
    // Fontos: a waypointok között az otthon is ott lehet, ezért a pozíció alapján keresünk
    const waypointIndex = routeWaypoints.findIndex(wp => wp.equals(latlngToRemove));
    if (waypointIndex > -1) {
        routeWaypoints.splice(waypointIndex, 1);
    }

    // Marker eltávolítása a térképről
    map.removeLayer(markerToRemove);
    updateRoute();
}

function closeLoopAtHome() {
    if (currentMode !== 'route' || !homeMarker || routeWaypoints.length < 2) return;

    // Hozzáadjuk az otthont, mint utolsó pontot, hogy bezárjuk a kört
    routeWaypoints.push(homeMarker.getLatLng());
    updateRoute();
    
    // Opcionális: jelezzük a felhasználónak, hogy a kör bezárult
    // Például letilthatnánk a további pontok hozzáadását, de egyelőre ennyi elég.
}

function isPointInAvoidZone(latlng) {
    return avoidZones.some(z => map.distance(latlng, z.circle.getLatLng()) <= z.circle.getRadius());
}

function adjustPointAwayFromZones(latlng) {
    let p = latlng;
    avoidZones.forEach(z => {
        const center = z.circle.getLatLng();
        const radius = z.circle.getRadius();
        const dist = map.distance(p, center);
        if (dist <= radius + 20) {
            const angle = Math.atan2(p.lat - center.lat, p.lng - center.lng) * 180 / Math.PI;
            p = destinationPoint(center.lat, center.lng, radius + 20, angle);
        }
    });
    return p;
}

function adjustWaypointsForAvoidZones(waypoints) {
    return waypoints.map(wp => adjustPointAwayFromZones(wp));
}

function routeCrossesAvoidZone(coords) {
    return coords.some(c => isPointInAvoidZone(L.latLng(c.lat, c.lng)));
}

function updateRoute() {
    if (routingControl) map.removeControl(routingControl);

    // Töröljük a távolságot, ha nincs elég pont
    if (routeWaypoints.length < 2) {
        document.getElementById('distance').textContent = '0.00 km';
        return;
    }

    const adjusted = adjustWaypointsForAvoidZones(routeWaypoints);

    routingControl = L.Routing.control({
        waypoints: adjusted,
        router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
        show: false,
        addWaypoints: false,
        createMarker: () => null, // Mi magunk kezeljük a jelölőket
        lineOptions: { styles: [{ color: '#5865f2', opacity: 0.8, weight: 6 }] }
    }).addTo(map);

    routingControl.on('routesfound', function(e) {
        const summary = e.routes[0].summary;
        const distance = summary.totalDistance / 1000;
        document.getElementById('distance').textContent = distance.toFixed(2) + ' km';

        if (routeCrossesAvoidZone(e.routes[0].coordinates)) {
            alert('Az útvonal áthalad egy piros zónán. Próbálj meg más pontokat használni.');
        }
    });
}

// --- Takarító és egyéb funkciók ---

function addAvoidFlag(latlng) {
    const marker = L.marker(latlng, { icon: avoidFlagIcon }).addTo(map);
    const circle = L.circle(latlng, {
        color: '#ed4245',
        fillColor: '#ed4245',
        fillOpacity: 0.25,
        radius: currentAvoidRadius
    }).addTo(map);

    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showAvoidControls(marker, circle);
    });

    avoidZones.push({ marker, circle });
}

function showAvoidControls(marker, circle) {
    const container = L.DomUtil.create('div', 'avoid-popup');
    const slider = L.DomUtil.create('input', '', container);
    slider.type = 'range';
    slider.min = 100;
    slider.max = 5000;
    slider.step = 100;
    slider.value = circle.getRadius();
    slider.addEventListener('input', () => {
        circle.setRadius(Number(slider.value));
    });

    const delBtn = L.DomUtil.create('button', '', container);
    delBtn.textContent = 'Törlés';
    delBtn.addEventListener('click', () => {
        removeAvoidZone(marker, circle);
        map.closePopup();
    });

    L.popup({ closeOnClick: false })
        .setLatLng(marker.getLatLng())
        .setContent(container)
        .openOn(map);
}

function removeAvoidZone(marker, circle) {
    map.removeLayer(marker);
    map.removeLayer(circle);
    avoidZones = avoidZones.filter(z => z.marker !== marker);
    map.closePopup();
}

function clearAvoidZone() {
    avoidZones.forEach(z => {
        map.removeLayer(z.marker);
        map.removeLayer(z.circle);
    });
    avoidZones = [];
}

// Segédfüggvény egy pont számításához adott távolságra és szögben
function destinationPoint(lat, lng, distance, bearing) {
    const R = 6371000; // földsugár méterben
    const brng = bearing * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lng * Math.PI / 180;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(distance / R) +
        Math.cos(lat1) * Math.sin(distance / R) * Math.cos(brng)
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(brng) * Math.sin(distance / R) * Math.cos(lat1),
        Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    );

    return L.latLng(lat2 * 180 / Math.PI, lon2 * 180 / Math.PI);
}

// Segédfüggvény egy kör mentén elhelyezett pontok generálásához
function circularWaypoints(center, radius, segments) {
    const points = [center];
    const offset = Math.random() * 360;
    for (let i = 0; i < segments; i++) {
        const angle = offset + (360 / segments) * i;
        let p = destinationPoint(center.lat, center.lng, radius, angle);
        p = adjustPointAwayFromZones(p);
        points.push(p);
    }
    points.push(center);
    return points;
}

// OSRM lekérdezés az útvonal tényleges hosszának meghatározásához
async function routeDistance(points) {
    const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url =
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes[0]) throw new Error('Sikertelen útvonalkérés');
    return data.routes[0].distance / 1000; // km
}

// Javított javasolt útvonal generátor
async function suggestRoute(distanceKm) {
    if (!homeMarker) {
        alert('Előbb állítsd be az otthonod!');
        return;
    }

    clearMap();

    const home = homeMarker.getLatLng();
    const segments = 8; // Pontok száma a körön
    let radius = (distanceKm * 1000) / (2 * Math.PI);

    let points = circularWaypoints(home, radius, segments);
    let dist = await routeDistance(points);

    // Iteratív korrekció, amíg közel nem kerülünk a kívánt távhoz
    for (let i = 0; i < 4 && Math.abs(dist - distanceKm) > 0.2; i++) {
        radius *= distanceKm / dist;
        points = circularWaypoints(home, radius, segments);
        dist = await routeDistance(points);
    }

    routeWaypoints = points;

    // Jelölők létrehozása (az első és utolsó pont az otthon)
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        const marker = L.marker(p, { icon: routePointIcon }).addTo(map);
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            removeRoutePoint(marker, p);
        });
        routeMarkers.push(marker);
    }

    updateRoute();
}

function clearMap() {
    // Útvonal és kék pontok törlése
    if (routingControl) map.removeControl(routingControl);
    routeMarkers.forEach(marker => map.removeLayer(marker));
    routeMarkers = [];
    routeWaypoints = [];
    document.getElementById('distance').textContent = '0.00 km';
    
    // Piros zóna törlése
    clearAvoidZone();
}

// Oldal betöltésekor hívjuk meg a mentett otthon betöltését
loadHomeLocation();
