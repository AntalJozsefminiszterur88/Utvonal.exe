// Globális változók
let map;
let currentMode = 'route';
let routeWaypoints = [];
let routeMarkers = []; // A kék pontok jelölőinek tárolója
let routingControl = null;
let avoidMarkers = [];
let avoidCircle = null;
let homeMarker = null;

// ÚJ: Szép, zöld házikó ikon
const homeIcon = L.icon({
    iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzNiYTU1ZCIgd2lkdGg9IjM4cHgiIGhlaWdodD0iMzhweCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMiA1LjY5bDUgNC41VjE4aC0yvjE2aC0zdi02SDl2Nkg2VjEwLjE5bDUtNC41TTQgMTBoOHYtM0w0IDh2MnpNMTIgMyAyIDIyaDEwbC04LTd2LTZoNnY0aDR2LTlsOC03eiIvPjwvc3ZnPg==',
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -38]
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
    const flagIcon = L.icon({ iconUrl: 'http://maps.google.com/mapfiles/ms/icons/red-flag.png', iconSize: [40, 40] });
    const marker = L.marker(latlng, { icon: flagIcon }).addTo(map);
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
