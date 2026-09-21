import Axios, { type AxiosRequestConfig } from 'axios'

export const AUTH_TOKEN_STORAGE_KEY = 'softtrack.token'

export const AXIOS_INSTANCE = Axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
})

AXIOS_INSTANCE.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

AXIOS_INSTANCE.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
      // /oauth/callback is the other route that exists to run without a valid
      // session, and it owns its own failure path. A hard navigation from here
      // would tear it down mid-exchange and replace the message it was about
      // to show with a bare /login.
      const path = window.location.pathname
      if (!path.startsWith('/login') && !path.startsWith('/oauth/callback')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

// Orval's axios mutator contract: takes an AxiosRequestConfig, returns a
// cancellable promise resolving to the response data.
export const apiClient = <T>(config: AxiosRequestConfig): Promise<T> => {
  const source = Axios.CancelToken.source()
  const promise = AXIOS_INSTANCE({ ...config, cancelToken: source.token }).then(
    ({ data }) => data,
  ) as Promise<T> & { cancel: () => void }
  promise.cancel = () => {
    source.cancel('Query was cancelled')
  }
  return promise
}

export default apiClient
