        async function initializeApp() {
            const artistsIndexResponse = await fetch('data/artists.json');
            if (!artistsIndexResponse.ok) {
                throw new Error('Impossible de charger la liste des artistes.');
            }

            const artistFiles = await artistsIndexResponse.json();
            if (!Array.isArray(artistFiles) || artistFiles.length === 0) {
                throw new Error('La liste des artistes est vide ou invalide.');
            }

            const artists = await Promise.all(artistFiles.map(async fileName => {
                if (typeof fileName !== 'string' || !/^[\w-]+\.json$/i.test(fileName)) {
                    throw new Error(`Nom de fichier artiste invalide : ${fileName}`);
                }

                const response = await fetch(`data/${fileName}`);
                if (!response.ok) {
                    throw new Error(`Impossible de charger le fichier artiste : ${fileName}`);
                }

                const artist = await response.json();
                if (!artist.name) {
                    throw new Error(`Nom d'artiste manquant dans : ${fileName}`);
                }

                return [fileName.replace(/\.json$/i, ''), artist];
            }));
            const artistsData = Object.fromEntries(artists);
            const artistSelect = document.getElementById('artistSelect');
            artistSelect.textContent = '';
            artists.forEach(([artistKey, artist]) => {
                const option = document.createElement('option');
                option.value = artistKey;
                option.textContent = artist.name;
                artistSelect.appendChild(option);
            });

        let currentArtistKey = artists[0][0];
        let tourDates = artistsData[currentArtistKey].dates;
        let monthLabels = artistsData[currentArtistKey].monthLabels;
        let timeStartIdx = 0;
        let timeEndIdx = monthLabels.length - 1;

        // Initialisation de la carte centrée sur la France, le Benelux et la Suisse (sans tuiles externes)
        const map = L.map('map', {
            zoomControl: true,
            minZoom: 5,
            maxZoom: 13
        }).setView([47.2, 2.8], 6);

        // Sources GeoJSON haute résolution (Natural Earth 1:10m) pour les frontières précises
        const NE_COUNTRIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
        const NE_PROVINCES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson';

        const neighborCodes = new Set(['ESP', 'PRT', 'ITA', 'DEU', 'GBR', 'IRL', 'AUT', 'LIE', 'MCO', 'AND']);
        const focusCountryCodes = new Set(['BEL', 'NLD', 'LUX', 'CHE']);

        // Chargement des pays haute résolution (frontières précises Benelux, Suisse & pays limitrophes)
        fetch(NE_COUNTRIES_URL)
            .then(res => res.ok ? res.json() : null)
            .then(geojson => {
                if (!geojson || !geojson.features) return;

                // 1. Pays limitrophes en arrière-plan
                const neighborFeatures = geojson.features.filter(f =>
                    neighborCodes.has(f.properties.ADM0_A3) || neighborCodes.has(f.properties.ISO_A3)
                );
                if (neighborFeatures.length > 0) {
                    L.geoJSON({ type: 'FeatureCollection', features: neighborFeatures }, {
                        style: {
                            color: '#cbd5e1',
                            weight: 1.1,
                            fillColor: '#f1f5f9',
                            fillOpacity: 0.9
                        },
                        interactive: false
                    }).addTo(map).bringToBack();
                }

                // 2. Benelux (Belgique, Pays-Bas, Luxembourg) et Suisse avec tracé précis des frontières
                const focusFeatures = geojson.features.filter(f =>
                    focusCountryCodes.has(f.properties.ADM0_A3) || focusCountryCodes.has(f.properties.ISO_A3)
                );
                if (focusFeatures.length > 0) {
                    L.geoJSON({ type: 'FeatureCollection', features: focusFeatures }, {
                        style: {
                            color: '#475569',
                            weight: 1.8,
                            fillColor: '#ffffff',
                            fillOpacity: 0.96
                        },
                        interactive: false
                    }).addTo(map);
                }
            })
            .catch(() => {});

        // Ajout des subdivisions internes (cantons suisses, provinces belges/néerlandaises, districts luxembourgeois) en trait fin
        fetch(NE_PROVINCES_URL)
            .then(res => res.ok ? res.json() : null)
            .then(geojson => {
                if (!geojson || !geojson.features) return;
                const subFeatures = geojson.features.filter(f => focusCountryCodes.has(f.properties.adm0_a3));
                if (subFeatures.length > 0) {
                    L.geoJSON({ type: 'FeatureCollection', features: subFeatures }, {
                        style: {
                            color: '#94a3b8',
                            weight: 0.9,
                            fillColor: 'transparent',
                            fillOpacity: 0
                        },
                        interactive: false
                    }).addTo(map);
                }
            })
            .catch(() => {});

        // Contour vectoriel des régions de France (haute précision IGN / OpenStreetMap)
        fetch('https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/regions.geojson')
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data) {
                    L.geoJSON(data, {
                        style: {
                            color: '#475569',
                            weight: 1.5,
                            fillColor: '#ffffff',
                            fillOpacity: 0.96
                        },
                        interactive: false
                    }).addTo(map);
                }
            })
            .catch(() => {});

        let markersLayer = L.layerGroup().addTo(map);
        let currentFilter = 'all';
        let markerRefs = {};

        function updateCounters(timeFilteredItems) {
            document.getElementById('count-all').textContent = timeFilteredItems.length;
            document.getElementById('count-dispo').textContent = timeFilteredItems.filter(d => d.status === 'dispo').length;
            document.getElementById('count-dernieres').textContent = timeFilteredItems.filter(d => d.status === 'dernieres').length;
            document.getElementById('count-complet').textContent = timeFilteredItems.filter(d => d.status === 'complet').length;
        }

        function getStatusMeta(status) {
            if (status === 'complet') {
                return {
                    badgeClass: 'status-complet',
                    arrowClass: 'arrow-complet',
                    icon: 'fa-ban',
                    label: 'Complet',
                    pillBg: 'bg-red-500/20 text-red-300 border-red-500/40'
                };
            }
            if (status === 'dernieres') {
                return {
                    badgeClass: 'status-dernieres',
                    arrowClass: 'arrow-dernieres',
                    icon: 'fa-fire',
                    label: 'Dernières places',
                    pillBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                };
            }
            return {
                badgeClass: 'status-dispo',
                arrowClass: 'arrow-dispo',
                icon: 'fa-calendar-day',
                label: 'Places dispo',
                pillBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40'
            };
        }

        function renderMapAndList() {
            markersLayer.clearLayers();
            markerRefs = {};
            const listContainer = document.getElementById('datesList');
            listContainer.innerHTML = '';

            const artist = artistsData[currentArtistKey];
            const query = document.getElementById('searchInput').value.toLowerCase().trim();

            const timeFiltered = tourDates.filter(item =>
                item.monthIdx >= timeStartIdx && item.monthIdx <= timeEndIdx
            );
            updateCounters(timeFiltered);

            const filtered = timeFiltered.filter(item => {
                const matchStatus = currentFilter === 'all' || item.status === currentFilter;
                const matchQuery = !query ||
                    item.city.toLowerCase().includes(query) ||
                    item.fullDate.toLowerCase().includes(query) ||
                    item.venue.toLowerCase().includes(query);
                return matchStatus && matchQuery;
            });

            if (filtered.length === 0) {
                listContainer.innerHTML = `
                    <div class="text-center py-10 text-slate-400 text-xs">
                        <i class="fa-regular fa-face-meh text-2xl mb-2 block text-slate-500"></i>
                        Aucune date ne correspond à votre filtre.
                    </div>
                `;
                return;
            }

            filtered.forEach((item, index) => {
                const meta = getStatusMeta(item.status);

                // Création de l'icône personnalisée contenant la date directement sur la carte
                const customIcon = L.divIcon({
                    className: 'date-badge-marker',
                    html: `
                        <div style="transform: translate(-50%, -100%); display: inline-block;">
                            <div class="pin-card ${meta.badgeClass}">
                                <i class="fa-solid ${meta.icon}"></i>
                                <span>${item.dateLabel}</span>
                            </div>
                            <div class="pin-arrow ${meta.arrowClass}"></div>
                        </div>
                    `,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0]
                });

                const popupHTML = `
                    <div class="min-w-[200px] text-slate-800">
                        <div class="flex items-center justify-between gap-2 mb-1">
                            <span class="font-extrabold text-sm text-slate-900">${item.city}</span>
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                item.status === 'complet' ? 'bg-red-100 text-red-700' :
                                item.status === 'dernieres' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
                            }">${meta.label}</span>
                        </div>
                        <p class="text-xs font-semibold text-slate-700 mb-0.5">
                            <i class="fa-regular fa-calendar mr-1 text-slate-500"></i> ${item.fullDate}
                        </p>
                        <p class="text-xs text-slate-500 mb-2.5">
                            <i class="fa-solid fa-location-dot mr-1 text-slate-400"></i> ${item.venue}
                        </p>
                        <a href="${artist.sourceUrl}" target="_blank" rel="noopener noreferrer"
                           class="block text-center w-full py-1.5 px-3 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition">
                            ${artist.ctaLabel} <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>
                        </a>
                    </div>
                `;

                const marker = L.marker([item.lat, item.lng], { icon: customIcon })
                    .bindPopup(popupHTML, { offset: [0, -28] });

                markersLayer.addLayer(marker);
                markerRefs[index] = marker;

                // Ajout dans la liste latérale
                const card = document.createElement('div');
                card.className = "bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 rounded-xl p-3 cursor-pointer transition flex items-center justify-between gap-2 group";
                card.innerHTML = `
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-sm text-white truncate group-hover:text-amber-300 transition">${item.city}</span>
                        </div>
                        <p class="text-xs text-slate-300 mt-0.5 font-medium">${item.fullDate}</p>
                        <p class="text-[11px] text-slate-400 truncate">${item.venue}</p>
                    </div>
                    <div class="flex flex-col items-end shrink-0 gap-1">
                        <span class="text-[11px] font-bold px-2 py-0.5 rounded-md border ${meta.pillBg}">
                            ${item.dateLabel}
                        </span>
                        <span class="text-[10px] text-slate-400">${meta.label}</span>
                    </div>
                `;

                card.addEventListener('click', () => {
                    map.flyTo([item.lat, item.lng], 11, { duration: 0.9 });
                    setTimeout(() => {
                        marker.openPopup();
                    }, 900);
                });

                listContainer.appendChild(card);
            });
        }

        function filterDates(status) {
            currentFilter = status;
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('ring-2', 'ring-white');
            });
            document.getElementById('btn-' + status).classList.add('ring-2', 'ring-white');
            renderMapAndList();
        }

        function handleSearch() {
            renderMapAndList();
        }

        function handleTimeSlider(changedThumb) {
            const startInput = document.getElementById('rangeStart');
            const endInput = document.getElementById('rangeEnd');
            let s = parseInt(startInput.value, 10);
            let e = parseInt(endInput.value, 10);

            if (changedThumb === 'start' && s > e) {
                s = e;
                startInput.value = s;
            } else if (changedThumb === 'end' && e < s) {
                e = s;
                endInput.value = e;
            }

            timeStartIdx = s;
            timeEndIdx = e;

            // Mise à jour visuelle de la barre dorée entre les deux curseurs
            const maxSteps = monthLabels.length - 1;
            const leftPct = (s / maxSteps) * 100;
            const widthPct = ((e - s) / maxSteps) * 100;
            const fill = document.getElementById('rangeFill');
            fill.style.left = leftPct + '%';
            fill.style.width = widthPct + '%';

            // Mise à jour du libellé de période
            const labelEl = document.getElementById('timeRangeLabel');
            labelEl.textContent = s === e ? monthLabels[s] : `${monthLabels[s]} – ${monthLabels[e]}`;

            // Afficher/masquer le bouton "Tout"
            const resetBtn = document.getElementById('resetTimeBtn');
            if (s === 0 && e === maxSteps) {
                resetBtn.classList.add('hidden');
            } else {
                resetBtn.classList.remove('hidden');
            }

            renderMapAndList();
        }

        function resetTimeRange() {
            document.getElementById('rangeStart').value = 0;
            document.getElementById('rangeEnd').value = monthLabels.length - 1;
            handleTimeSlider('start');
        }

        function switchArtist(artistKey) {
            if (!artistsData[artistKey]) return;
            currentArtistKey = artistKey;
            const artist = artistsData[artistKey];

            tourDates = artist.dates;
            monthLabels = artist.monthLabels;

            // Mise à jour des textes et liens d'en-tête et pied de page
            document.getElementById('artistSubtitle').textContent = artist.subtitle;
            document.getElementById('sourceText').textContent = artist.sourceLabel;
            document.getElementById('sourceLink').href = artist.sourceUrl;

            // Adaptation du curseur temporel à la plage de l'artiste sélectionné
            const maxSteps = monthLabels.length - 1;
            const startInput = document.getElementById('rangeStart');
            const endInput = document.getElementById('rangeEnd');
            startInput.max = maxSteps;
            endInput.max = maxSteps;
            startInput.value = 0;
            endInput.value = maxSteps;

            const ticksContainer = document.getElementById('sliderTicks');
            ticksContainer.innerHTML = artist.tickLabels.map(t => `<span>${t}</span>`).join('');

            // Réinitialiser les filtres et recentrer la carte
            currentFilter = 'all';
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('ring-2', 'ring-white'));
            document.getElementById('btn-all').classList.add('ring-2', 'ring-white');
            document.getElementById('searchInput').value = '';

            handleTimeSlider('start');
            resetViewFrance();
        }

        function resetViewFrance() {
            map.flyTo([47.2, 2.8], 6, { duration: 0.8 });
        }

        function zoomBenelux() {
            map.flyTo([50.25, 5.1], 8, { duration: 0.8 });
        }

        function zoomSuisse() {
            map.flyTo([46.8, 7.6], 8, { duration: 0.8 });
        }

        function zoomParisIDF() {
            map.flyTo([48.85, 2.45], 10, { duration: 0.8 });
        }

        document.getElementById('artistSelect').addEventListener('change', event => switchArtist(event.target.value));
        document.querySelectorAll('[data-filter]').forEach(button => {
            button.addEventListener('click', () => filterDates(button.dataset.filter));
        });
        document.querySelector('[data-view="france"]').addEventListener('click', resetViewFrance);
        document.querySelector('[data-view="benelux"]').addEventListener('click', zoomBenelux);
        document.querySelector('[data-view="suisse"]').addEventListener('click', zoomSuisse);
        document.querySelector('[data-view="paris"]').addEventListener('click', zoomParisIDF);
        document.getElementById('resetTimeBtn').addEventListener('click', resetTimeRange);
        document.getElementById('rangeStart').addEventListener('input', () => handleTimeSlider('start'));
        document.getElementById('rangeEnd').addEventListener('input', () => handleTimeSlider('end'));
        document.getElementById('searchInput').addEventListener('input', handleSearch);

        // Initialisation au chargement
        switchArtist(currentArtistKey);
        }

        initializeApp().catch(error => console.error('Erreur lors du chargement des données des artistes :', error));
