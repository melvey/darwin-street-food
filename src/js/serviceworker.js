const CACHE_TITLE = 'foodvans-cache';
const CACHE_VERSION = 'v1';
const CACHE_NAME = `${CACHE_TITLE}-${CACHE_VERSION}`;
var urlsToCache = [
	'.',
	'style.css',
	'start.js',
	'images/logo-60x50.png',
	'images/clock.svg',
	'images/map-pin.svg'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(urlsToCache))
	);
});

self.addEventListener('fetch', (event) => event.respondWith(
	caches.match(event.request)
		.then((response) => response
			? response
			: fetch(event.request)
		)
));

self.addEventListener('activate', (event) => event.waitUntil(
	caches.keys().then((cacheNames) => Promise.all(
		cacheNames.map((cacheName) => {
			if(cacheName !== CACHE_NAME && cacheName.indexOf(CACHE_TITLE) === 0) {
				return caches.delete(cacheName);
			}
		})
	))
));
