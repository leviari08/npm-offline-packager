const pacote = require('pacote');
const semver = require('semver');
const { merge } = require('lodash');
const { red } = require('chalk').default;
const { join } = require('path');
const { cache, resolvedPackages } = require('./cache');
const { execSync } = require('child_process');

// Set cache folder to npm cache folder
const npmCacheFolderPath = execSync('npm config get cache', { encoding: 'utf8' }).trim();
const pacoteCacheFolder = process.env.CACHE_FOLDER || join(npmCacheFolderPath, '_cacache');

/**
 * Download packages tarball
 *
 * @param {{ name: string, version:string, isLatest: boolean }[]} packages The packages array
 * @param {any} options The options
 */
async function downloadPackages(packages, options = {}) {
    const logger = options.logger || (() => { });
    const destFolder = options.destFolder || '.';
    const { useCache } = options;
    let counter = 0;

    // If cache enabled filter the dependencies that exist inn cache
    const packagesToDownload = useCache
        ? packages.filter(({ name, version }) => !cache.exist(name, version))
        : packages;

    // Download packages tarballs and add them to cache
    const result = await Promise.allSettled(packagesToDownload.map(p =>
        downloadPackageTarball(p.name, p.version, { destFolder, isLatest: p.isLatest, registry: options.registry })
            .then(res => {
                counter++;
                const { name, version } = res;

                const percent = (1 / packagesToDownload.length) * counter;
                logger(`Fetching packages: ${name}@${version}`, percent);

                if (useCache) {
                    cache.add(name, version)
                }
                return res;
            }).catch(error => {
                handlerError(error);
                return null;
            })
    ));
    return result;
}

/**
 * Download package tarball to dest folder
 *
 * @param {string} name The package name
 * @param {string} version The package version
 * @param {{destFolder: string, isLatest?: boolean}} options The options
 *
 * @returns {Promise<{name: string, version: string, isLatest: boolean}>}
 */
async function downloadPackageTarball(name, version = 'latest', options = { destFolder: '.', registry: undefined }) {
    const { destFolder, isLatest, registry } = options;
    return pacote.tarball.toFile(
        `${name}@${version}`,
        `${destFolder}/${name.replace('/', '-')}-${version}${isLatest ? '-latest' : ''}.tgz`,
        { cache: pacoteCacheFolder, registry }
    ).then(() => ({name, version, isLatest: Boolean(isLatest)}));
}

/**
 * Get package dependencies from manifest
 *
 * @param {object} manifest The package manifest
 * @param {object} options the options
 *
 * @returns {{name: string, version: string}[]} Array of dependencies
 */
function getManifestDependencies(manifest, options = {}) {
    const packages = merge(
        manifest.dependencies,
        options.dev ? manifest.devDependencies : {},
        options.peer ? manifest.peerDependencies : {},
        options.optional ? manifest.optionalDependencies : {},
    );

    return Object.keys(packages).map((name) => {
        let version = packages[name];
        let cleanVersion = version.replace('^', '').replace('~', '');

        if (!semver.valid(cleanVersion)) {
            const coerceVersion = semver.coerce(cleanVersion);
            version = !coerceVersion ? 'latest' : coerceVersion.version;
            cleanVersion = version;
        }

        return {
            name,
            version,
        };
    });
}

/**
 * Resolve all package dependencies recursively
 *
 * @param {any} manifest The package manifest (package.json file)
 * @param {any} options The options
 *
 * @returns {Promise<{ name: string, version:string, isLatest: boolean }[]>} Promise of dependencies array
 */
async function resolveDependencies(manifest, options) {
    const logger = options.logger || (() => { });

    // Get dependencies array from manifest
    const dependencies = getManifestDependencies(manifest, options);

    // Return a empty array in case of no dependencies
    if (!dependencies.length) {
        return [];
    }

    options.depth = options.depth || 0;
    options.progress = options.progress || 0;

    // Resolve dependencies childs recursively
    let manifests = await Promise.all(
        dependencies
            .filter(({ name, version }) => !resolvedPackages.get(name, version))
            .map(({ name, version }) => getPackageManifest(name, version, options).catch(handlerError))
    );

    // Chack if package with real version already added
    manifests = manifests.filter(currManifest => currManifest && !resolvedPackages.get(currManifest.name, currManifest.version))

    // Add package version to cache (in memory)
    manifests.forEach(p => {
        logger(`Resolving dependencies: ${p.name}@${p.version}`, options.progress);
        resolvedPackages.set(p.name, p.version)
    })

    const result = [];
    for (const currManifest of manifests) {
        result.push({ name: currManifest.name, version: currManifest.version, isLatest: currManifest.isLatest });
        const dependenciesChilds = await resolveDependencies(currManifest, Object.assign(options, { depth: options.depth + 1 }));

        // Add the current percent to progress bar (calculate only in packages at the top of the tree)
        if (options.depth === 0) {
            options.progress += 1 / dependencies.length;
        }

        // Concat dependencies to array result
        result.push(...dependenciesChilds);
    };

    return result;
}

/**
 * Get package manifest from npm (package.json file), use npm cache folder
 *
 * @param {string} packageName
 * @param {string} packageVersion
 */
async function getPackageManifest(packageName, packageVersion = 'latest', opts = { registry: undefined }) {
    const pacoteOptions = { cache: pacoteCacheFolder, registry: opts.registry };

    return Promise.all([
        pacote.manifest(`${packageName}@${packageVersion}`, pacoteOptions)
            .catch((error) => {
                if (error.code === 'ETARGET') {
                    const { latest } = error.distTags;
                    return pacote.manifest(`${packageName}@${latest}`, pacoteOptions);
                }

                if (error.code === 'E404') {
                    console.error(`\nError: "${packageName}@${packageVersion}" not found`);
                    return packageVersion !== 'latest' ? pacote.manifest(packageName, pacoteOptions)
                        : Promise.reject(new Error(`${packageName}@${packageVersion} not found`));
                }

                return Promise.reject(error);
            }),
        packageVersion !== 'latest' ? pacote.packument(packageName, pacoteOptions) : Promise.resolve(),
    ])
        .then(([manifest, packument]) => {
            if (packument) {
                manifest.isLatest = packument['dist-tags'].latest === manifest.version;
            } else {
                manifest.isLatest = true;
            }

            return manifest;
        });
}

/**
 * Print promise catch error
 *
 * @param {Error} error
 */
function handlerError(error) {
    console.error(error && error.message ? red(error.message) : error);
}

module.exports = {
    getPackageManifest,
    resolveDependencies,
    downloadPackageTarball,
    downloadPackages,
};
