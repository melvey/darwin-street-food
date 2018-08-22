
const url = 'https://opendata.arcgis.com/datasets/f62cbfbf11494495984097ef8ed6a8a9_0.geojson';

function loadList() {
	return fetch(url)
		.then((response) => response.json())
		.then((data) => data.features
				? data.features.map((feature) => feature.properties)
				: undefined
		);

};

export default loadList;
