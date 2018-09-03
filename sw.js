(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

var CACHE_TITLE = 'foodvans-cache';
var CACHE_VERSION = 'v2';
var CACHE_NAME = CACHE_TITLE + '-' + CACHE_VERSION;
var urlsToCache = ['.', 'style.css', 'start.js', 'images/logo-60x50.png', 'images/clock.svg', 'images/map-pin.svg'];

self.addEventListener('install', function (event) {
	event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
		return cache.addAll(urlsToCache);
	}));
});

self.addEventListener('fetch', function (event) {
	return event.respondWith(caches.match(event.request).then(function (response) {
		return response ? response : fetch(event.request);
	}));
});

self.addEventListener('activate', function (event) {
	return event.waitUntil(caches.keys().then(function (cacheNames) {
		return Promise.all(cacheNames.map(function (cacheName) {
			if (cacheName !== CACHE_NAME && cacheName.indexOf(CACHE_TITLE) === 0) {
				return caches.delete(cacheName);
			}
		}));
	}));
});

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvanMvc2VydmljZXdvcmtlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7O0FDQUEsSUFBTSxjQUFjLGdCQUFwQjtBQUNBLElBQU0sZ0JBQWdCLElBQXRCO0FBQ0EsSUFBTSxhQUFnQixXQUFoQixTQUErQixhQUFyQztBQUNBLElBQUksY0FBYyxDQUNqQixHQURpQixFQUVqQixXQUZpQixFQUdqQixVQUhpQixFQUlqQix1QkFKaUIsRUFLakIsa0JBTGlCLEVBTWpCLG9CQU5pQixDQUFsQjs7QUFTQSxLQUFLLGdCQUFMLENBQXNCLFNBQXRCLEVBQWlDLFVBQUMsS0FBRCxFQUFXO0FBQzNDLE9BQU0sU0FBTixDQUNDLE9BQU8sSUFBUCxDQUFZLFVBQVosRUFDRSxJQURGLENBQ08sVUFBQyxLQUFEO0FBQUEsU0FBVyxNQUFNLE1BQU4sQ0FBYSxXQUFiLENBQVg7QUFBQSxFQURQLENBREQ7QUFJQSxDQUxEOztBQU9BLEtBQUssZ0JBQUwsQ0FBc0IsT0FBdEIsRUFBK0IsVUFBQyxLQUFEO0FBQUEsUUFBVyxNQUFNLFdBQU4sQ0FDekMsT0FBTyxLQUFQLENBQWEsTUFBTSxPQUFuQixFQUNFLElBREYsQ0FDTyxVQUFDLFFBQUQ7QUFBQSxTQUFjLFdBQ2pCLFFBRGlCLEdBRWpCLE1BQU0sTUFBTSxPQUFaLENBRkc7QUFBQSxFQURQLENBRHlDLENBQVg7QUFBQSxDQUEvQjs7QUFRQSxLQUFLLGdCQUFMLENBQXNCLFVBQXRCLEVBQWtDLFVBQUMsS0FBRDtBQUFBLFFBQVcsTUFBTSxTQUFOLENBQzVDLE9BQU8sSUFBUCxHQUFjLElBQWQsQ0FBbUIsVUFBQyxVQUFEO0FBQUEsU0FBZ0IsUUFBUSxHQUFSLENBQ2xDLFdBQVcsR0FBWCxDQUFlLFVBQUMsU0FBRCxFQUFlO0FBQzdCLE9BQUcsY0FBYyxVQUFkLElBQTRCLFVBQVUsT0FBVixDQUFrQixXQUFsQixNQUFtQyxDQUFsRSxFQUFxRTtBQUNwRSxXQUFPLE9BQU8sTUFBUCxDQUFjLFNBQWQsQ0FBUDtBQUNBO0FBQ0QsR0FKRCxDQURrQyxDQUFoQjtBQUFBLEVBQW5CLENBRDRDLENBQVg7QUFBQSxDQUFsQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsImNvbnN0IENBQ0hFX1RJVExFID0gJ2Zvb2R2YW5zLWNhY2hlJztcbmNvbnN0IENBQ0hFX1ZFUlNJT04gPSAndjInO1xuY29uc3QgQ0FDSEVfTkFNRSA9IGAke0NBQ0hFX1RJVExFfS0ke0NBQ0hFX1ZFUlNJT059YDtcbnZhciB1cmxzVG9DYWNoZSA9IFtcblx0Jy4nLFxuXHQnc3R5bGUuY3NzJyxcblx0J3N0YXJ0LmpzJyxcblx0J2ltYWdlcy9sb2dvLTYweDUwLnBuZycsXG5cdCdpbWFnZXMvY2xvY2suc3ZnJyxcblx0J2ltYWdlcy9tYXAtcGluLnN2Zydcbl07XG5cbnNlbGYuYWRkRXZlbnRMaXN0ZW5lcignaW5zdGFsbCcsIChldmVudCkgPT4ge1xuXHRldmVudC53YWl0VW50aWwoXG5cdFx0Y2FjaGVzLm9wZW4oQ0FDSEVfTkFNRSlcblx0XHRcdC50aGVuKChjYWNoZSkgPT4gY2FjaGUuYWRkQWxsKHVybHNUb0NhY2hlKSlcblx0KTtcbn0pO1xuXG5zZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2ZldGNoJywgKGV2ZW50KSA9PiBldmVudC5yZXNwb25kV2l0aChcblx0Y2FjaGVzLm1hdGNoKGV2ZW50LnJlcXVlc3QpXG5cdFx0LnRoZW4oKHJlc3BvbnNlKSA9PiByZXNwb25zZVxuXHRcdFx0PyByZXNwb25zZVxuXHRcdFx0OiBmZXRjaChldmVudC5yZXF1ZXN0KVxuXHRcdClcbikpO1xuXG5zZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2FjdGl2YXRlJywgKGV2ZW50KSA9PiBldmVudC53YWl0VW50aWwoXG5cdGNhY2hlcy5rZXlzKCkudGhlbigoY2FjaGVOYW1lcykgPT4gUHJvbWlzZS5hbGwoXG5cdFx0Y2FjaGVOYW1lcy5tYXAoKGNhY2hlTmFtZSkgPT4ge1xuXHRcdFx0aWYoY2FjaGVOYW1lICE9PSBDQUNIRV9OQU1FICYmIGNhY2hlTmFtZS5pbmRleE9mKENBQ0hFX1RJVExFKSA9PT0gMCkge1xuXHRcdFx0XHRyZXR1cm4gY2FjaGVzLmRlbGV0ZShjYWNoZU5hbWUpO1xuXHRcdFx0fVxuXHRcdH0pXG5cdCkpXG4pKTtcbiJdfQ==
