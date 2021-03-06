import PluginManager from './PluginManager';
import type { Diagnostic, File } from './interfaces';
import { InternalPlugin } from './InternalPlugin';
import { printDiagnostic } from './diagnosticUtils';
import * as path from 'path';
import type { Options } from './StaticSiteGenerator';
import type { TextFile } from './files/TextFile';
import { replacePath, standardizePath } from './util';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Tree } from './Tree';
import * as fsExtra from 'fs-extra';

export class Project {
    constructor(
        options: Options
    ) {
        this.pluginManager.add(new InternalPlugin());
        this.setOptions(options);
    }

    public options: Options;

    private pluginManager = new PluginManager();

    /**
     * Get the diagnostics from all files
     */
    public getDiagnostics() {
        const result = [] as Diagnostic[];
        for (const file of this.files.values()) {
            result.push(
                ...file.diagnostics
            );
        }
        return result;
    }

    /**
     * Map of all files in the project, indexed by absolute path
     */
    public files = new Map<string, File>();

    /**
     * Get the file with the specified path
     */
    public getFile<T extends File = File>(filePath: string) {
        filePath = path.resolve(this.options.sourceDir, filePath).replace(/[\\\/]/g, path.sep);
        return this.files.get(filePath) as T;
    }

    /**
     * Get a tree of all the html files based on their output paths
     */
    public getTree() {
        if (!this.cache.tree) {
            this.cache.tree = new Tree(undefined, undefined, undefined);
            for (let file of this.files.values()) {
                const filename = path.basename(file.outPath);

                //skip files starting with underscore, and skip all non-html files
                if (filename.startsWith('_') || !filename.toLowerCase().endsWith('.html')) {
                    continue;
                }

                const relativePath = file.outPath.replace(this.options.outDir + path.sep, '').replace(/\.\w$/, '');
                this.cache.tree.add(relativePath, file);
            }
            this.cache.tree.sort();
        }
        return this.cache.tree as Tree;
    }

    /**
     * Add or replace a file in the project
     */
    public setFile(srcPath: string): File;
    public setFile(fileEntry: { src: string; dest: string }): File;
    public setFile(param: string | { src: string; dest: string }): File {
        let srcPath: string;
        let outPath: string;
        if (typeof param === 'string') {
            srcPath = path.resolve(this.options.sourceDir, param);
            outPath = replacePath(
                path.resolve(this.options.outDir, param),
                this.options.sourceDir,
                this.options.outDir
            );
        } else {
            srcPath = path.resolve(this.options.sourceDir, param.src);
            outPath = path.resolve(this.options.outDir, param.dest);
        }

        let file = this.files.get(srcPath);
        //add the file
        if (!file) {
            file = this.pluginManager.getFirst('provideFile', {
                project: this,
                srcPath: srcPath,
                outPath: outPath
            });
            //link this project to the file
            file.project = this;
            this.files.set(srcPath, file);
            this.pluginManager.emit('onFileAdd', { project: this, file: file });
        }

        this.pluginManager.emit('beforeFileLoad', { project: this, file: file });

        //if the file has a load function
        file.load?.();

        this.pluginManager.emit('afterFileLoad', { project: this, file: file });
        return file;
    }

    /**
     * Remove a file from the project
     */
    public removeFile(srcPath: string) {
        srcPath = path.resolve(this.options.sourceDir, srcPath);
        const file = this.files.get(srcPath);
        if (file) {
            this.pluginManager.emit('onFileRemove', { project: this, file: file });
            this.files.delete(srcPath);
            //delete the file from the outDir too
            if (fsExtra.pathExistsSync(file.outPath)) {
                fsExtra.removeSync(file.outPath);
            }
        }
    }

    /**
     * Validate the entire project
     */
    public validate() {
        for (const file of this.files.values()) {
            file.diagnostics = [];
            this.pluginManager.emit('beforeFileValidate', { project: this, file: file });
            file.validate?.();

            this.pluginManager.emit('afterFileValidate', { project: this, file: file });

            for (const diagnostic of file.diagnostics ?? []) {
                printDiagnostic(diagnostic);
            }
        }
    }

    /**
     * Determine if the given file exists somewhere within the sourceDir
     */
    private fileResidesInSourceDir(file: File) {
        return file.srcPath.startsWith(this.options.sourceDir);
    }

    /**
     * Get the template file for a given file
     */
    public getTemplateFile(file: TextFile): File {
        //if the file specified a template, use that file (even if it doesn't exist...)
        if (file.attributes.template) {
            const templateSrcPath = standardizePath(path.dirname(file.srcPath), file.attributes.template as string);
            if (!this.files.has(templateSrcPath)) {
                file.diagnostics.push({
                    file: file,
                    ...DiagnosticMessages.missingTemplate(templateSrcPath)
                });
            }
            return this.files.get(templateSrcPath);

            //files outside of sourceDir
        } else if (!this.fileResidesInSourceDir(file)) {
            return this.files.get(
                standardizePath(path.dirname(file.srcPath), '_template.html')
            ) ?? this.files.get(
                standardizePath(path.dirname(file.srcPath), '_template.ejs')
            );

            //files inside sourceDir
        } else {
            //walk up the directory tree and use the closest _template.{ejs,html} file

            let dir = file.srcPath.replace(this.options.sourceDir + path.sep, '');
            // eslint-disable-next-line no-cond-assign
            while (dir = path.dirname(dir)) {
                for (const ext of ['.ejs', '.html']) {
                    const templatePath = path.resolve(
                        this.options.sourceDir,
                        path.normalize(
                            path.join(dir, '_template' + ext)
                        )
                    );
                    if (this.files.has(templatePath)) {
                        return this.files.get(templatePath);
                    }
                }
                //quit the loop if we didn't find a template
                if (dir === '.') {
                    return;
                }
            }
        }
    }

    /**
     * Given a file, look up its template and then generate the output text
     * using the ejs templating engine.
     * If the template could not be found, the content is returned as-is
     */
    public generateWithTemplate(file: TextFile, content: string) {
        const templateFile = this.getTemplateFile(file);
        if (templateFile?.renderAsTemplate) {
            //return template rendered (or empty string)
            return templateFile.renderAsTemplate(file, content) ?? '';
        } else {
            //no template was found. return the content as-is (or empty string)
            return content ?? '';
        }
    }

    /**
     * A cache that can be used by templates and plugins. This is cleared before every publish
     */
    public cache: Record<string, any>;

    public publish() {
        this.cache = {};
        for (const file of this.files.values()) {
            this.pluginManager.emit('beforeFilePublish', { project: this, file: file });
            const startsWithUnderscore = path.basename(file.srcPath).startsWith('_');

            //skip publishing if the file starts with an underscore, or if the
            if (!startsWithUnderscore) {
                file.publish?.();
            }

            this.pluginManager.emit('afterFilePublish', { project: this, file: file });
        }
    }

    /**
     * Sanitize the given options in-place
     */
    private setOptions(options: Options) {
        this.options = {} as Options;
        this.options.cwd = standardizePath(process.cwd(), options.cwd).replace(/[\\\/]+$/, '');
        this.options.sourceDir = this.resolvePath(options.sourceDir, 'src').replace(/[\\\/]+$/, '');
        this.options.outDir = this.resolvePath(options.outDir, 'dist').replace(/[\\\/]+$/, '');
        this.options.files = options.files ?? ['**/*'];
        this.options.watch = options.watch === true;
        return options;
    }

    /**
     * Given a path, convert to an absolute path and use the current OS path.sep
     */
    private resolvePath(thePath?: string, defaultValue?: string) {
        return path.normalize(
            path.resolve(
                this.options.cwd,
                thePath ?? defaultValue
            )
        ).replace(/[\\\/]/g, path.sep);
    }

}
