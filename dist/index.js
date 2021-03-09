"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const architect_1 = require("@angular-devkit/architect");
const fs_1 = require("fs");
const glob = require("glob");
const discover_packages_1 = require("ng-packagr/lib/ng-package/discover-packages");
const path_1 = require("path");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const Webpack = require("webpack");
exports.default = architect_1.createBuilder((options, context) => {
    var _a;
    const project = path_1.resolve(context.workspaceRoot, options.project);
    const projectName = (_a = context.target) === null || _a === void 0 ? void 0 : _a.project;
    return rxjs_1.from(Promise.resolve().then(() => require("ng-packagr"))).pipe(operators_1.map((res) => res.ngPackagr()), operators_1.switchMap((packager) => {
        if (options.tsConfig) {
            packager.withTsConfig(options.tsConfig);
        }
        packager.forProject(project);
        return options.watch ? packager.watch() : packager.buildAsObservable();
    }), operators_1.switchMap(() => rxjs_1.from(discover_packages_1.discoverPackages({ project }))), operators_1.switchMap((pkg) => {
        const compiler = Webpack({
            entry: path_1.resolve(pkg.dest, "esm2015", "public-api.js"),
            output: {
                path: pkg.dest,
                library: "widgetLibs",
                libraryTarget: "var",
                filename: `${projectName}.js`,
            },
            externals: {
                "@angular/core": "__ng_core__",
            },
            mode: "none",
            optimization: {
                minimize: true,
            },
        });
        return compilerAsObservable(compiler, projectName !== null && projectName !== void 0 ? projectName : "widget-libs", pkg.dest, "widgetLibs");
    }), operators_1.map(() => ({ success: true })));
});
function compilerAsObservable(compiler, projectName, dest, name) {
    return rxjs_1.from(new Promise((resolve, reject) => {
        compiler.run((err) => {
            if (err) {
                reject(err);
            }
            else {
                glob(`${dest}/*`, (err, matches) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        try {
                            matches
                                .filter((item) => item !== `${dest}/${projectName}.js`)
                                .forEach((item) => {
                                const stat = fs_1.statSync(item);
                                if (stat.isDirectory()) {
                                    fs_1.rmdirSync(item, { recursive: true });
                                }
                                else {
                                    fs_1.unlinkSync(item);
                                }
                            });
                        }
                        catch (error) {
                            reject(error);
                        }
                        const content = fs_1.readFileSync(path_1.resolve(dest, `${projectName}.js`)).toString();
                        fs_1.writeFileSync(path_1.resolve(dest, `${projectName}.js`), `(function(){return function(__ng_core__){${content}return ${name}}})();`, { flag: "w" });
                        resolve();
                    }
                });
            }
        });
    }));
}
