const store = 'darwin-street-food';
const version = 1;
const vendorStoreName = 'vendors';

class DBHandler {
	constructor() {

		this.pendingActions = [];
		this.connect();

		this.saveData = this.saveData.bind(this);
		this.getAllData = this.getAllData.bind(this);
		this._getAllDataForPromise = this._getAllDataForPromise.bind(this);
	}

	errorHandler(evt) {
		console.error('DB Error', evt.target.error);
	}

	upgradeDB(evt) {
		const db = evt.target.result;

		if(evt.oldVersion < 1) {
			const vendorStore = db.createObjectStore(vendorStoreName, {keyPath: 'id'});
			vendorStore.createIndex('name', 'name', {unique: true});
		}
	}

	connect() {
		const connRequest = indexedDB.open(store, version);

		connRequest.addEventListener('success', (evt) => {
			this.db = evt.target.result;
			this.db.addEventListener('error', this.errorHandler);

			if(this.pendingActions) {
				while(this.pendingActions.length < 0) {
					this.pendingActions.pop()();
				}
			}
		});

		connRequest.addEventListener('upgradeneeded', this.upgradeDB);

		connRequest.addEventListener('error', this.errorHandler);
	}

	saveData(data) {
		if(!this.db) {
			this.pendingActions.push(() => this.saveData(data));
			return;
		}

		const dataArr = Array.isArray(data)
			? data
			: [data];

		const transaction = this.db.transaction(vendorStoreName, 'readwrite');
		var vendorStore = transaction.objectStore(vendorStoreName);

		dataArr.forEach((vendorData) => vendorStore
			.get(vendorData.id)
			.onsuccess = (evt) => {
				if(evt.target.result) {
					if(JSON.stringify(evt.target.result) !== JSON.stringify(vendorData)) {
						vendorStore.put(vendorData);
					}
				} else {
					vendorStore.add(vendorData);
				}
			});

	}

	_getAllDataForPromise(resolve, reject) {
		if(!this.db) {
			this.pendingActions.push(() => this._getAllDataForPromise(resolve, reject));
			return;
		}
		const vendorData = [];
		const vendorStore = this.db.transaction(vendorStoreName).objectStore(vendorStoreName);
		const cursor = vendorStore.openCursor();
		
		cursor.onsuccess = (evt) => {
			const cursor = evt.target.result;
			if(cursor) {
				vendorData.push(cursor.value);
				return cursor.continue();
			}
			resolve(vendorData);
		};

		cursor.onerror = (evt) => reject(evt.target.error);
	}

	getAllData() {
		return new Promise(this._getAllDataForPromise);
	}


}

export default DBHandler;
