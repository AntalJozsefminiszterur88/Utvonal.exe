// Globális változók
let map;
let currentMode = 'route';
let routeWaypoints = [];
let routeMarkers = []; // A kék pontok jelölőinek tárolója
let routingControl = null;
let avoidMarkers = [];
let avoidCircle = null;
let homeMarker = null;

// ÚJ: házikó ikon a repo-ban található képből
const homeIcon = L.icon({
    iconUrl: 'ház.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
});

// Zászló ikon az elkerülő pontokhoz
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

function setMode(mode) {
    currentMode = mode;
    ['route', 'avoid', 'home'].forEach(m => {
        document.getElementById(`mode-${m}`).classList.toggle('active', m === mode);
    });
    const container = map.getContainer();
    if (mode === 'home') {
        container.style.cursor = "url('ház.png') 20 20, auto";
    } else if (mode === 'avoid') {
        container.style.cursor = "url('zászló.png') 15 30, auto";
    } else {
        container.style.cursor = '';
    }
}

map.on('click', function(e) {
    if (currentMode === 'route') addRoutePoint(e.latlng);
    else if (currentMode === 'avoid') addAvoidFlag(e.latlng);
    else if (currentMode === 'home') setHomeLocation(e.latlng);
});

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

function updateRoute() {
    if (routingControl) map.removeControl(routingControl);
    
    // Töröljük a távolságot, ha nincs elég pont
    if (routeWaypoints.length < 2) {
        document.getElementById('distance').textContent = '0.00 km';
        return;
    }

    routingControl = L.Routing.control({
        waypoints: routeWaypoints,
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
    });
}

// --- Takarító és egyéb funkciók ---

function addAvoidFlag(latlng) {
    if (avoidMarkers.length >= 2) clearAvoidZone();
    const marker = L.marker(latlng, { icon: avoidFlagIcon }).addTo(map);
    avoidMarkers.push(marker);

    if (avoidMarkers.length === 2) {
        const center = avoidMarkers[0].getLatLng();
        const radius = map.distance(center, avoidMarkers[1].getLatLng());
        avoidCircle = L.circle(center, { color: '#ed4245', fillColor: '#ed4245', fillOpacity: 0.25, radius: radius }).addTo(map);
    }
}

function clearAvoidZone() {
    avoidMarkers.forEach(marker => map.removeLayer(marker));
    avoidMarkers = [];
    if (avoidCircle) map.removeLayer(avoidCircle);
    avoidCircle = null;
}

function clearMap() {
    // Útvonal és kék pontok törlése
    if (routingControl) map.removeControl(routingControl);
    routeMarkers.forEach(marker => map.removeLayer(marker));
    routeMarkers = [];
    routeWaypoints = [];
    document.getElementById('distance').textContent = '0.00 km';
    
    // Elkerülő zóna törlése
    clearAvoidZone();
}

// Oldal betöltésekor hívjuk meg a mentett otthon betöltését
loadHomeLocation();
