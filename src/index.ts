import { createBuilder } from "@angular-devkit/architect";
import { NgPackagrBuilderOptions } from "@angular-devkit/build-angular";
import { json } from "@angular-devkit/core";
import { readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import * as glob from "glob";
import { discoverPackages } from "ng-packagr/lib/ng-package/discover-packages";
import { resolve as pathResolve } from "path";
import { from } from "rxjs";
import { map, switchMap } from "rxjs/operators";
import * as Webpack from "webpack";

export default createBuilder<NgPackagrBuilderOptions & json.JsonObject>((options, context) => {
  const project = pathResolve(context.workspaceRoot, options.project);
  const projectName = context.target?.project;

  return from(import("ng-packagr")).pipe(
    map((res) => res.ngPackagr()),
    switchMap((packager) => {
      packager.forProject(project);
      return options.watch ? packager.watch() : packager.buildAsObservable();
    }),
    switchMap(() => from(discoverPackages({ project }))),
    switchMap((pkg) => {
      const compiler = Webpack({
        entry: pathResolve(pkg.dest, "esm2015", "public-api.js"),
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
      return compilerAsObservable(compiler, projectName ?? "widget-libs", pkg.dest, "widgetLibs");
    }),
    map(() => ({ success: true }))
  );
});

function compilerAsObservable(compiler: Webpack.Compiler, projectName: string, dest: string, name: string) {
  return from(
    new Promise<void>((resolve, reject) => {
      compiler.run((err) => {
        if (err) {
          reject(err);
        } else {
          glob(`${dest}/*`, (err, matches) => {
            if (err) {
              reject(err);
            } else {
              try {
                matches
                  .filter((item) => item !== `${dest}/${projectName}.js`)
                  .forEach((item) => {
                    const stat = statSync(item);
                    if (stat.isDirectory()) {
                      rmdirSync(item, { recursive: true });
                    } else {
                      unlinkSync(item);
                    }
                  });
              } catch (error) {
                reject(error);
              }
              const content = readFileSync(pathResolve(dest, `${projectName}.js`)).toString();
              writeFileSync(
                pathResolve(dest, `${projectName}.js`),
                `(function(){return function(__ng_core__){${content}return ${name}}})();`,
                { flag: "w" }
              );
              resolve();
            }
          });
        }
      });
    })
  );
}
