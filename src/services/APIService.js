import axios from 'axios';

// A service class for all REST API operations
class APIService {
    #axiosInstance;
    #tokenServiceInstance;

    constructor(tokenService) {
        // Set Axios baseURL to 100ms API BaseURI
        this.#axiosInstance = axios.create({
            baseURL: "https://api.100ms.live/v2",
            timeout: 3 * 60000 // 3 minutes timeout
        });
        this.#tokenServiceInstance = tokenService;
        this.#configureAxios();
    }

    // Add Axios interceptors to process all requests and responses
    #configureAxios() {
        // Request interceptor to add Authorization header
        this.#axiosInstance.interceptors.request.use(
            (config) => {
                // Add Authorization on every request made using the Management token
                config.headers = {
                    Authorization: `Bearer ${this.#tokenServiceInstance.getManagementToken()}`,
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    ...config.headers
                };
                return config;
            },
            (error) => {
                console.error("Error in request interceptor", error);
                return Promise.reject(error);
            }
        );

        // Response interceptor to handle token refresh on 401/403
        this.#axiosInstance.interceptors.response.use(
            (response) => {
                return response;
            },
            async (error) => {
                console.error("Error in making API call", {
                    status: error.response?.status,
                    data: error.response?.data,
                    url: error.config?.url
                });

                const originalRequest = error.config;

                if (
                    (error.response?.status === 403 || error.response?.status === 401) &&
                    !originalRequest._retry
                ) {
                    console.log("🔄 Retrying request with refreshed management token");
                    originalRequest._retry = true;

                    try {
                        // Force refresh Management token on error making API call
                        const newToken = this.#tokenServiceInstance.getManagementToken(true);
                        originalRequest.headers.Authorization = `Bearer ${newToken}`;

                        return this.#axiosInstance(originalRequest);
                    } catch (retryError) {
                        console.error("❌ Unable to retry request after token refresh!", retryError);
                        return Promise.reject(retryError);
                    }
                }

                return Promise.reject(error);
            }
        );
    }

    // A method for GET requests using the configured Axios instance
    async get(path, queryParams = {}) {
        try {
            const res = await this.#axiosInstance.get(path, { params: queryParams });
            console.log(`✅ GET call to path - ${path}, status code - ${res.status}`);
            return res.data;
        } catch (error) {
            console.error(`❌ GET call failed to path - ${path}`, error.response?.data || error.message);
            throw error;
        }
    }

    // A method for POST requests using the configured Axios instance
    async post(path, payload = {}) {
        try {
            const res = await this.#axiosInstance.post(path, payload);
            console.log(`✅ POST call to path - ${path}, status code - ${res.status}`);
            return res.data;
        } catch (error) {
            console.error(`❌ POST call failed to path - ${path}`, error.response?.data || error.message);
            throw error;
        }
    }

    // A method for PATCH requests using the configured Axios instance
    async patch(path, payload = {}) {
        try {
            const res = await this.#axiosInstance.patch(path, payload);
            console.log(`✅ PATCH call to path - ${path}, status code - ${res.status}`);
            return res.data;
        } catch (error) {
            console.error(`❌ PATCH call failed to path - ${path}`, error.response?.data || error.message);
            throw error;
        }
    }

    // A method for DELETE requests using the configured Axios instance
    async delete(path) {
        try {
            const res = await this.#axiosInstance.delete(path);
            console.log(`✅ DELETE call to path - ${path}, status code - ${res.status}`);
            return res.data;
        } catch (error) {
            console.error(`❌ DELETE call failed to path - ${path}`, error.response?.data || error.message);
            throw error;
        }
    }
}

export { APIService };