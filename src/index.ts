import { createBuilder } from "@angular-devkit/architect";
import { NgPackagrBuilderOptions } from "@angular-devkit/build-angular";
import { json } from "@angular-devkit/core";
import { rmdirSync, statSync, unlinkSync } from "fs";
import * as glob from "glob";
import { discoverPackages } from "ng-packagr/lib/ng-package/discover-packages";
import { resolve as pathResolve } from "path";
import { from, throwError } from "rxjs";
import { catchError, map, switchMap } from "rxjs/operators";
import { Compiler } from "webpack";
import * as WebpackDevServer from "webpack-dev-server";
import * as Webpack from "webpack";
const ConcatSource = require("webpack-sources").ConcatSource;

export default createBuilder<NgPackagrBuilderOptions & { devPort?: number } & json.JsonObject>(
  (options, context) => {
    const project = pathResolve(context.workspaceRoot, options.project);
    const projectName = context.target?.project;

    return from(import("ng-packagr")).pipe(
      map((res) => res.ngPackagr()),
      switchMap((packager) => {
        if (options.tsConfig) {
          packager.withTsConfig(options.tsConfig);
        }
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
          externals: { "@angular/core": "__ng_core__" },
          mode: "none",
          optimization: { minimize: true },
          plugins: [new LibWrapper({ fileName: `${projectName}.js`, libName: "widgetLibs" })],
        });

        return options.watch
          ? devCompileAsObservable(compiler, projectName ?? "", options.devPort)
          : compileAsObservable(compiler, projectName ?? "", pkg.dest);
      }),
      map(() => ({ success: true })),
      catchError((err) => {
        console.log(err);
        return throwError(err);
      })
    );
  }
);

function compileAsObservable(compiler: Compiler, projectName: string, dest: string) {
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
              resolve();
            }
          });
        }
      });
    })
  );
}

function devCompileAsObservable(compiler: Compiler, fileName: string, port = 3003) {
  return from(
    new Promise((resolve, reject) => {
      new WebpackDevServer(compiler, {
        compress: true,
        publicPath: "/",
        filename: fileName,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
        },
      }).listen(port ?? 3003, "0.0.0.0", (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve("");
        }
      });
    })
  );
}

class LibWrapper {
  options: { fileName: string; libName: string };
  constructor(options: { fileName: string; libName: string }) {
    this.options = options;
  }
  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap("LibWrapper", (compilation) => {
      compilation.hooks.afterOptimizeAssets.tap("LibWrapper", () => {
        if (compilation.assets[this.options.fileName]) {
          compilation.assets[this.options.fileName] = new ConcatSource(
            "(function(){return function (__ng__core){",
            compilation.assets[this.options.fileName],
            `return ${this.options.libName}}})();`
          );
        }
      });
    });
  }
}
