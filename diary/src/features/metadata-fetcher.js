import { showToast } from './toast.js';
import { updateEntry } from './database.js';
import { updateDateDisplay } from '../state.js';

/**
 * Weather codes mapped to simple descriptions and icons.
 * Open-Meteo uses WMO Weather interpretation codes (WW).
 */
export function getWeatherInfo(code, isDay) {
    const isNight = isDay === 0;
    
    if (code === 0) return { text: 'Clear', icon: isNight ? 'fa-moon' : 'fa-sun' };
    if (code >= 1 && code <= 3) return { text: 'Partly Cloudy', icon: isNight ? 'fa-cloud-moon' : 'fa-cloud-sun' };
    if (code >= 45 && code <= 48) return { text: 'Fog', icon: 'fa-smog' };
    if (code >= 51 && code <= 67) return { text: 'Rain', icon: 'fa-cloud-rain' };
    if (code >= 71 && code <= 77) return { text: 'Snow', icon: 'fa-snowflake' };
    if (code >= 80 && code <= 82) return { text: 'Showers', icon: 'fa-cloud-showers-heavy' };
    if (code >= 95 && code <= 99) return { text: 'Thunderstorm', icon: 'fa-bolt' };
    return { text: 'Unknown', icon: 'fa-cloud' };
}

/**
 * Initiates the metadata fetching process for a specific diary entry.
 * @param {string} entryId - The UUID of the database entry to update.
 */
export async function attachMetadataToEntry(entryId) {
    if (localStorage.getItem('disable_location_weather') === 'true') {
        // Clear the Locating... tag from the UI by forcing a re-render
        // The default values in the DB are already empty/null.
        updateDateDisplay();
        return; 
    }

    async function applyLocationAndWeather(lat, lon, city) {
        try {
            const updates = {
                location_city: city,
                location_lat: lat,
                location_lon: lon
            };

            // Fetch Weather via Open-Meteo
            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
            const weatherResponse = await fetch(weatherUrl);
            const weatherData = await weatherResponse.json();
            
            if (weatherData && weatherData.current_weather) {
                updates.weather_temp = Math.round(weatherData.current_weather.temperature);
                const code = weatherData.current_weather.weathercode;
                const isDay = weatherData.current_weather.is_day; // 1 or 0
                const wInfo = getWeatherInfo(code, isDay);
                updates.weather_condition = wInfo.text;
                updates.weather_icon = wInfo.icon;
            }

            // Save to Dexie and Refresh UI
            await updateEntry(entryId, updates);
            updateDateDisplay();
            
        } catch (err) {
            console.error("Failed to fetch weather data:", err);
            // Even if weather fails, try to save location
            await updateEntry(entryId, {
                location_city: city,
                location_lat: lat,
                location_lon: lon
            });
            updateDateDisplay();
        }
    }

    async function fallbackToIP() {
        try {
            const ipGeoUrl = `https://ipapi.co/json/`;
            const response = await fetch(ipGeoUrl);
            const data = await response.json();
            let city = data.city || "Unknown Location";
            let lat = data.latitude;
            let lon = data.longitude;

            // ISP Correction: Many ISPs in Kurdistan map IP addresses to Sulaymaniyah or Baghdad.
            // Since the user is explicitly in Erbil, we auto-correct this.
            if (data.country === "Iraq" || city.includes("Sulaym") || city === "Tremani") {
                city = "Erbil";
                lat = 36.1900;
                lon = 44.0090;
            }

            await applyLocationAndWeather(lat, lon, city);
        } catch (err) {
            console.error("IP fallback also failed:", err);
            // Absolute fallback to Erbil if no internet or IP API blocked
            await applyLocationAndWeather(36.1900, 44.0090, "Erbil");
            showToast('<i class="fa-solid fa-location-crosshairs" style="color: #f59e0b;"></i> Defaulting to Erbil.');
        }
    }

    if (!window.isSecureContext || !navigator.geolocation) {
        console.warn("Geolocation is not supported or not in a secure context. Falling back to IP.");
        fallbackToIP();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            try {
                // If we got GPS coordinates, we can still reverse geocode to get the city
                const geoUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
                const geoResponse = await fetch(geoUrl);
                const geoData = await geoResponse.json();
                let city = geoData.city || geoData.locality || "Unknown Location";
                
                // Extra safety for GPS reverse geocode mapping weirdly
                if (city.includes("Sulaym")) city = "Erbil";

                await applyLocationAndWeather(lat, lon, city);
            } catch (err) {
                console.error("Reverse geocoding failed, falling back to IP:", err);
                fallbackToIP();
            }
        },
        (err) => {
            console.warn("geolocation failed", { code: err.code, message: err.message });
            fallbackToIP();
        },
        {
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 300000
        }
    );
}
