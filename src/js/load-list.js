
const url = 'data.json';

function loadList() {
	return fetch(url)
		.then((response) => response.json())
		.then((data) => data.features
				? data.features.map((feature) => feature.properties)
				: undefined
		);

};

export default loadList;
