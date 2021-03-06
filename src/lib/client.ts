import {
    CdnLoadingGraphErrorEvent,
    errorFactory,
    FetchErrors,
    InstallModulesInputs,
    LoadingGraph,
    InstallScriptsInputs,
    SourceLoadedEvent,
    SourceLoadingEvent,
    StartEvent,
    InstallStyleSheetsInputs,
    InstallLoadingGraphInputs,
    FetchScriptInputs,
    QueryLoadingGraphInputs,
    InstallInputs,
    CdnEvent,
    FetchedScript,
    InstallStyleSheetInputsDeprecated,
} from './models'
import { State } from './state'
import { LoadingScreenView } from './loader.view'
import { sanitizeCssId } from './utils.view'
import { satisfies } from 'semver'
import {
    addScriptElements,
    applyFinalSideEffects,
    applyModuleSideEffects,
    onHttpRequestLoad,
    sanitizeModules,
    parseResourceId,
} from './utils'

/**
 *
 * Use default [[Client]] to install a set of resources, see [[Client.install]]
 *
 * @category Getting Started
 * @category Entry points
 * @param inputs
 */
export function install(inputs: InstallInputs): Promise<Window>

/**
 *
 * Use default [[Client]] to install a set of resources, see [[Client.install]]
 *
 * @deprecated
 * @category Deprecated
 * @param inputs
 * @param options
 */
export function install(
    inputs: InstallInputs,
    options?: {
        executingWindow?: Window
        onEvent?: (event: CdnEvent) => void
        displayLoadingScreen?: boolean
    },
): Promise<Window>

export function install(
    inputs: InstallInputs,
    options?: {
        executingWindow?: Window
        onEvent?: (event: CdnEvent) => void
        displayLoadingScreen?: boolean
    },
): Promise<Window> {
    return options
        ? new Client().install({ ...inputs, ...options })
        : new Client().install(inputs)
}

/**
 * @param inputs
 * @category Entry points
 */
export function queryLoadingGraph(inputs: QueryLoadingGraphInputs) {
    return new Client().queryLoadingGraph(inputs)
}

/**
 * @param inputs
 * @category Entry points
 */
export function fetchScript(inputs: FetchScriptInputs): Promise<FetchedScript> {
    return new Client().fetchScript(inputs)
}

/**
 * @category Entry points
 * @param inputs
 */
export function installLoadingGraph(inputs: InstallLoadingGraphInputs) {
    return new Client().installLoadingGraph(inputs)
}

/**
 * @category Entry points
 * @param inputs
 */
export function installModules(inputs: InstallModulesInputs) {
    return new Client().installModules(inputs)
}

/**
 * @category Entry points
 * @param inputs
 */
export function installScripts(inputs: InstallScriptsInputs) {
    return new Client().installScripts(inputs)
}

/**
 * @category Entry points
 * @param inputs
 */
export function installStyleSheets(inputs: InstallStyleSheetsInputs) {
    return new Client().installStyleSheets(inputs)
}

/**
 * Class gathering methods to dynamically install various set of resources (modules, scripts, stylesheets).
 *
 * The usual method used in this class is [[Client.install]].
 *
 * ## Versions management
 *
 * The client handle the case of installing multiple versions of a library.
 * The resolution of the loading graph is based on information provided at build time in the package.json.
 * See the section 'Package publication' in the
 * [youwol's user guide](https://platform.youwol.com/applications/@youwol/stories/latest?id=fa525fef-cb28-40fb-94d0-c45c2b464571)
 *
 * ## Difference between modules & scripts
 *
 * Installing a module will trigger installation of its direct and indirect dependencies,
 * while installing a script only install the provided target
 *
 * @category Getting Started
 * @category Entry points
 */
export class Client {
    static Headers: { [key: string]: string } = {}
    static HostName = '' // By default, relative resolution is used. Otherwise, protocol + hostname

    /**
     * Headers used when doing HTTP requests, see [[Client.constructor]]
     */
    public readonly headers: { [key: string]: string } = {}

    /**
     * Hostname used when doing HTTP requests, see [[Client.constructor]]
     */
    public readonly hostName: string

    /**
     * @param params specifies how to handle HTTP requests by setting [[Client.headers]] & [[Client.HostName]]
     * @param params.headers `this.headers =  headers ? {...Client.Headers, ...headers } : Client.Headers`
     * @param params.hostName `this.hostName = hostName ? hostName : Client.HostName`
     */
    constructor(
        params: {
            headers?: { [_key: string]: string }
            hostName?: string
        } = {},
    ) {
        this.headers = { ...Client.Headers, ...(params.headers || {}) }
        this.hostName = params.hostName || Client.HostName
    }

    /**
     * Query a loading graph provided a list of modules.
     *
     * See description in [[QueryLoadingGraphInputs]].
     *
     * @param inputs
     */
    async queryLoadingGraph(
        inputs: QueryLoadingGraphInputs,
    ): Promise<LoadingGraph> {
        const key = JSON.stringify(inputs)
        const usingDependencies = inputs.usingDependencies || []
        const body = {
            libraries: sanitizeModules(inputs.modules),
            using: usingDependencies.reduce((acc, dependency) => {
                return {
                    ...acc,
                    [dependency.split('#')[0]]: dependency.split('#')[1],
                }
            }, {}),
        }
        const finalize = async () => {
            const content = await State.fetchedLoadingGraph[key]
            if (content.lock) {
                return content
            }
            throw errorFactory(content)
        }
        if (State.fetchedLoadingGraph[key]) {
            return finalize()
        }
        const url = `${Client.HostName}/api/assets-gateway/cdn-backend/queries/loading-graph`
        const request = new Request(url, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { ...this.headers, 'content-type': 'application/json' },
        })
        State.fetchedLoadingGraph[key] = fetch(request).then((resp) =>
            resp.json(),
        )
        return finalize()
    }

    /**
     * Fetch a script.
     *
     * See description in [[FetchScriptInputs]].
     *
     * @param inputs
     */
    async fetchScript(inputs: FetchScriptInputs): Promise<FetchedScript> {
        let { url, onEvent, name } = inputs
        if (!url.startsWith('/api/assets-gateway/raw/package')) {
            url = url.startsWith('/') ? url : `/${url}`
            url = `/api/assets-gateway/raw/package${url}`
        }

        const parts = url.split('/')
        const assetId = parts[5]
        const version = parts[6]
        name = name || parts[parts.length - 1]

        if (State.importedScripts[url]) {
            const { progressEvent } = await State.importedScripts[url]
            onEvent &&
                onEvent(
                    new SourceLoadedEvent(name, assetId, url, progressEvent),
                )
            return State.importedScripts[url]
        }
        State.importedScripts[url] = new Promise((resolve, reject) => {
            const req = new XMLHttpRequest()
            // report progress events
            req.addEventListener(
                'progress',
                function (event) {
                    onEvent &&
                        onEvent(
                            new SourceLoadingEvent(name, assetId, url, event),
                        )
                },
                false,
            )

            req.addEventListener(
                'load',
                function (event: ProgressEvent<XMLHttpRequestEventTarget>) {
                    onHttpRequestLoad(
                        req,
                        event,
                        resolve,
                        reject,
                        { url, name, assetId, version },
                        onEvent,
                    )
                },
                false,
            )
            req.open('GET', url)
            req.responseType = 'text' // Client.responseParser ? 'blob' : 'text'
            req.send()
            onEvent && onEvent(new StartEvent(name, assetId, url))
        })
        return State.importedScripts[url]
    }

    /**
     * Install a various set of modules, scripts & stylesheets.
     *
     * See description in [[InstallInputs]].
     *
     * @param inputs
     */
    install(inputs: InstallInputs): Promise<Window> {
        const css = inputs.css || []
        const executingWindow = inputs.executingWindow || window
        const aliases = inputs.aliases || {}
        const display = inputs.displayLoadingScreen || false
        let loadingScreen = undefined

        if (display) {
            loadingScreen = new LoadingScreenView()
            loadingScreen.render()
        }
        const onEvent = (ev) => {
            loadingScreen && loadingScreen.next(ev)
            inputs.onEvent && inputs.onEvent(ev)
        }

        const bundlePromise = this.installModules({
            modules: inputs.modules,
            modulesSideEffects: inputs.modulesSideEffects,
            usingDependencies: inputs.usingDependencies,
            executingWindow,
            onEvent,
        })

        const cssPromise = this.installStyleSheets({
            css,
            renderingWindow: inputs.executingWindow,
        })
        const jsPromise = bundlePromise.then((resp) => {
            State.updateLatestBundleVersion(resp, executingWindow)
            return this.installScripts({
                scripts: inputs.scripts || [],
                executingWindow,
            })
        })

        return Promise.all([jsPromise, cssPromise]).then(() => {
            applyFinalSideEffects({
                aliases,
                executingWindow,
                onEvent,
                loadingScreen,
            })
            return executingWindow
        })
    }

    /**
     * Install a loading graph.
     *
     * See description in [[InstallLoadingGraphInputs]].
     *
     * See also [[Client.queryLoadingGraph]] & [[queryLoadingGraph]]
     *
     * @param inputs
     */
    async installLoadingGraph(inputs: InstallLoadingGraphInputs) {
        const executingWindow = inputs.executingWindow || window

        const libraries = inputs.loadingGraph.lock.reduce(
            (acc, e) => ({ ...acc, ...{ [e.id]: e } }),
            {},
        )

        const packagesSelected = inputs.loadingGraph.definition
            .flat()
            .map(([assetId, cdn_url]) => {
                return {
                    assetId,
                    url: `/api/assets-gateway/raw/package/${cdn_url}`,
                    name: libraries[assetId].name,
                    version: libraries[assetId].version,
                }
            })

        const errors = []
        const futures = packagesSelected.map(({ name, url }) => {
            return this.fetchScript({
                name,
                url,
                onEvent: inputs.onEvent,
            }).catch((error) => {
                errors.push(error)
            })
        })
        const sourcesOrErrors = await Promise.all(futures)
        if (errors.length > 0) {
            throw new FetchErrors({ errors })
        }
        const sources = sourcesOrErrors
            .filter((d) => d != undefined)
            .map((d) => d as FetchedScript)
            .filter(
                ({ name, version }) =>
                    !State.isCompatibleVersionInstalled(name, version),
            )
            .map((origin: FetchedScript) => {
                const userSideEffects = Object.entries(
                    inputs.modulesSideEffects || {},
                )
                    .filter(([_, val]) => {
                        return val != undefined
                    })
                    .filter(([key, _]) => {
                        const query = key.includes('#') ? key : `${key}#*`
                        if (query.split('#')[0] != origin.name) return false
                        return satisfies(origin.version, query.split('#')[1])
                    })
                    .map(([_, value]) => value)
                return {
                    ...origin,
                    sideEffect: ({
                        htmlScriptElement,
                    }: {
                        htmlScriptElement: HTMLScriptElement
                    }) => {
                        applyModuleSideEffects(
                            origin,
                            htmlScriptElement,
                            executingWindow,
                            userSideEffects,
                        )
                    },
                }
            })

        addScriptElements(sources, executingWindow, inputs.onEvent)
    }

    /**
     * Install a set of modules.
     *
     * See description in [[InstallModulesInputs]].
     *
     * @param inputs
     */
    async installModules(inputs: InstallModulesInputs): Promise<LoadingGraph> {
        const usingDependencies = inputs.usingDependencies || []
        const modules = sanitizeModules(inputs.modules || [])
        const body = {
            modules: modules,
            usingDependencies,
        }
        const modulesSideEffects = modules.reduce(
            (acc, dependency) => ({
                ...acc,
                [`${dependency.name}#${dependency.version}`]:
                    dependency.sideEffects,
            }),
            inputs.modulesSideEffects || {},
        )
        try {
            const loadingGraph = await this.queryLoadingGraph(body)
            await this.installLoadingGraph({
                loadingGraph,
                modulesSideEffects,
                executingWindow: inputs.executingWindow,
                onEvent: inputs.onEvent,
            })
            return loadingGraph
        } catch (error) {
            inputs.onEvent &&
                inputs.onEvent(new CdnLoadingGraphErrorEvent(error))
            throw error
        }
    }

    /**
     * Install a set of scripts.
     *
     * See description in [[InstallScriptsInputs]].
     *
     * @param inputs
     */
    async installScripts(
        inputs: InstallScriptsInputs,
    ): Promise<{ assetName; assetId; url; src }[]> {
        const client = new Client()

        const scripts = inputs.scripts
            .map((elem) =>
                typeof elem == 'string'
                    ? { location: elem, sideEffects: undefined }
                    : elem,
            )
            .map((elem) => ({ ...elem, ...parseResourceId(elem.location) }))

        const futures = scripts.map(({ name, url, sideEffects }) =>
            client
                .fetchScript({
                    name,
                    url,
                    onEvent: inputs.onEvent,
                })
                .then((fetchedScript) => {
                    return { ...fetchedScript, sideEffects }
                }),
        )

        const sourcesOrErrors = await Promise.all(futures)
        const sources = sourcesOrErrors.filter(
            (d) => !(d instanceof ErrorEvent),
        )

        addScriptElements(sources, inputs.executingWindow, inputs.onEvent)

        return sources.map(({ assetId, url, name, content }) => {
            return { assetId, url, assetName: name, src: content }
        })
    }

    /**
     * Install a set of stylesheets.
     *
     * See description in [[InstallStyleSheetsInputs]].
     *
     * @param inputs
     */
    installStyleSheets(
        inputs: InstallStyleSheetsInputs | InstallStyleSheetInputsDeprecated,
    ): Promise<Array<HTMLLinkElement>> {
        const css = inputs.css.map((stylesheet) =>
            stylesheet.resource ? stylesheet.resource : stylesheet,
        )
        const renderingWindow = inputs.renderingWindow || window

        const getLinkElement = (url) => {
            return Array.from(
                renderingWindow.document.head.querySelectorAll('link'),
            ).find((e) => e.href == this.hostName + url)
        }
        const futures = css
            .map((elem) =>
                typeof elem == 'string'
                    ? {
                          location: elem,
                      }
                    : elem,
            )
            .map((elem) => ({ ...elem, ...parseResourceId(elem.location) }))
            .filter(({ url }) => !getLinkElement(url))
            .map(({ assetId, version, name, url, sideEffects }) => {
                return new Promise<HTMLLinkElement>((resolveCb) => {
                    const link = renderingWindow.document.createElement('link')
                    link.id = url
                    const classes = [assetId, name, version].map((key) =>
                        sanitizeCssId(key),
                    )
                    link.classList.add(...classes)
                    link.setAttribute('type', 'text/css')
                    link.href = this.hostName + url
                    link.rel = 'stylesheet'
                    renderingWindow.document
                        .getElementsByTagName('head')[0]
                        .appendChild(link)
                    link.onload = () => {
                        sideEffects &&
                            sideEffects({
                                origin: {
                                    moduleName: name,
                                    version,
                                    assetId,
                                    url,
                                },
                                htmlLinkElement: link,
                                renderingWindow,
                            })
                        resolveCb(link)
                    }
                })
            })
        return Promise.all(futures)
    }
}
