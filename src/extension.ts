import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as yaml from "js-yaml";
import {
  Project,
  SourceFile,
  SyntaxKind,
  FunctionDeclaration,
  ArrowFunction,
  FunctionExpression,
  JSDoc,
} from "ts-morph";
import ignore from "ignore";

// 拡張機能のアクティベート関数
export function activate(context: vscode.ExtensionContext) {
  console.log('拡張機能 "code-is-document" が有効化されました');

  // 最初のコマンド（YAML出力）の登録
  const dependenciesCommand = vscode.commands.registerCommand(
    "code-is-document.showDependencies",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage("開いているワークスペースがありません");
        return;
      }

      try {
        // 現在のワークスペースのルートパス
        const rootPath = workspaceFolders[0].uri.fsPath;

        // コード解析の実行
        const result = await analyzeCode(rootPath);

        // YAML形式に変換
        const yamlResult = yaml.dump(result, { indent: 2 });

        // 出力ファイルパス
        const outputPath = path.join(rootPath, "code-document.yaml");

        // ファイルに書き出し
        fs.writeFileSync(outputPath, yamlResult, "utf8");

        vscode.window.showInformationMessage(
          `コード解析が完了しました。結果は ${outputPath} に保存されました。`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`エラーが発生しました: ${error}`);
      }
    }
  );

  // 新しいコマンド（D3.js可視化）の登録
  const visualizeCommand = vscode.commands.registerCommand(
    "code-is-document.visualizeStructure",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage("開いているワークスペースがありません");
        return;
      }

      try {
        // 現在のワークスペースのルートパス
        const rootPath = workspaceFolders[0].uri.fsPath;

        // YAMLファイルのパス
        const yamlPath = path.join(rootPath, "code-document.yaml");

        // YAMLファイルが存在するか確認
        if (!fs.existsSync(yamlPath)) {
          const result = await vscode.window.showWarningMessage(
            "コード構造ファイル(code-document.yaml)が見つかりません。今すぐ生成しますか？",
            "はい",
            "いいえ"
          );

          if (result === "はい") {
            // 解析コマンドを実行
            await vscode.commands.executeCommand(
              "code-is-document.showDependencies"
            );
          } else {
            return;
          }
        }

        // YAMLファイルを読み込む
        const yamlContent = fs.readFileSync(yamlPath, "utf8");
        const projectData = yaml.load(yamlContent);

        // ウェブビューパネルを作成
        const panel = vscode.window.createWebviewPanel(
          "codeVisualization",
          "コード構造の可視化",
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)],
          }
        );

        // ウェブビューのHTMLを設定
        panel.webview.html = getVisualizationHtml(projectData);

        // メッセージハンドラーを設定
        panel.webview.onDidReceiveMessage(
          (message) => {
            switch (message.command) {
              case "alert":
                vscode.window.showInformationMessage(message.text);
                return;
            }
          },
          undefined,
          context.subscriptions
        );
      } catch (error) {
        vscode.window.showErrorMessage(`エラーが発生しました: ${error}`);
      }
    }
  );

  context.subscriptions.push(dependenciesCommand);
  context.subscriptions.push(visualizeCommand);
}

// 可視化用のHTMLを生成する関数
function getVisualizationHtml(projectData: any): string {
  return `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>コード構造の可視化</title>
      <script src="https://d3js.org/d3.v7.min.js"></script>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 10px;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          overflow: auto;
        }
        
        svg {
          min-width: 100%;
          min-height: 800px;
        }
        
        .node circle {
          stroke-width: 1.5px;
        }
        
        .node text {
          font-size: 12px;
          fill: var(--vscode-editor-foreground);
          font-weight: normal;
        }
        
        .node-file circle {
          fill: #4686c6;
          stroke: #3973a8;
        }
        
        .node-directory circle {
          fill: #e8b03c;
          stroke: #c99c2e;
        }
        
        /* ノードにマウスオーバーした時のハイライト */
        .node:hover circle {
          stroke-width: 2.5px;
          filter: brightness(1.2);
        }
        
        .node:hover text {
          font-weight: bold;
        }
        
        .link {
          fill: none;
          stroke: var(--vscode-editorIndentGuide-background);
          stroke-width: 1.5px;
          opacity: 0.7;
        }
        
        .tooltip {
          position: absolute;
          padding: 10px;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          border: 1px solid var(--vscode-editorWidget-border);
          border-radius: 5px;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
          pointer-events: none;
          max-width: 400px;
          z-index: 10;
        }
        
        .tooltip strong {
          color: var(--vscode-editorLink-activeForeground);
        }
        
        .tooltip small {
          color: var(--vscode-descriptionForeground);
        }
        
        .controls {
          margin-bottom: 20px;
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 100;
          background-color: var(--vscode-editor-background);
          padding: 10px;
          border-radius: 5px;
          border: 1px solid var(--vscode-widget-border);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 12px;
          cursor: pointer;
          border-radius: 2px;
          margin-right: 5px;
        }
        
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        h1 {
          color: var(--vscode-titleBar-activeForeground);
          font-size: 22px;
          margin-bottom: 20px;
        }
        
        .legend {
          position: fixed;
          bottom: 20px;
          left: 20px;
          background-color: var(--vscode-editor-background);
          border: 1px solid var(--vscode-widget-border);
          padding: 10px;
          border-radius: 5px;
          z-index: 100;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          margin-bottom: 8px;
        }
        
        .legend-item:last-child {
          margin-bottom: 0;
        }
        
        .legend-color {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          margin-right: 8px;
        }
        
        .legend-directory {
          background-color: #e8b03c;
          border: 1.5px solid #c99c2e;
        }
        
        .legend-file {
          background-color: #4686c6;
          border: 1.5px solid #3973a8;
        }
      </style>
    </head>
    <body>
      <h1>コード構造の可視化</h1>
      <div class="controls">
        <button id="zoomIn">拡大</button>
        <button id="zoomOut">縮小</button>
        <button id="resetZoom">リセット</button>
      </div>
      <div class="legend">
        <div class="legend-item">
          <div class="legend-color legend-directory"></div>
          <span>ディレクトリ</span>
        </div>
        <div class="legend-item">
          <div class="legend-color legend-file"></div>
          <span>ファイル</span>
        </div>
      </div>
      <div id="visualization"></div>
      
      <script>
        (function() {
          // プロジェクトデータをJavaScriptオブジェクトとして渡す
          const projectData = ${JSON.stringify(projectData)};
          
          // D3.jsを使用した可視化の実装
          const width = Math.max(window.innerWidth - 40, 1200);
          const height = Math.max(window.innerHeight - 100, 800);
          
          // ツールチップの作成
          const tooltip = d3.select("body").append("div")
            .attr("class", "tooltip")
            .style("opacity", 0);
          
          // SVG要素の作成
          const svg = d3.select("#visualization").append("svg")
            .attr("width", width)
            .attr("height", height)
            .call(d3.zoom().on("zoom", (event) => {
              g.attr("transform", event.transform);
            }));
          
          const g = svg.append("g");
          
          // 階層構造用のレイアウト関数を定義
          // 十分な垂直スペースを確保するためにサイズを大きくする
          const nodeCount = countNodes(projectData);
          const dynamicHeight = Math.max(height, nodeCount * 20); // 各ノードに少なくとも20pxの垂直スペースを確保
          
          const tree = d3.tree()
            .size([dynamicHeight, width - 300])
            .separation((a, b) => {
              // 隣接するノード間の距離を調整
              // 同じ親を持つノード間は距離を広げる
              return (a.parent === b.parent ? 1.5 : 2);
            });
          
          // プロジェクト内のノード数を数える補助関数
          function countNodes(data) {
            let count = 0;
            
            function countDir(dir) {
              // ファイルをカウント
              if (dir.files) {
                count += dir.files.length;
              }
              
              // サブディレクトリを再帰的にカウント
              if (dir.directories) {
                count += Object.keys(dir.directories).length;
                for (const subDirName in dir.directories) {
                  countDir(dir.directories[subDirName]);
                }
              }
            }
            
            countDir(data.root);
            return count;
          }
          
          // プロジェクトデータを階層構造に変換
          function convertToHierarchy(data) {
            const root = { name: data.root.path, children: [] };
            
            // ディレクトリの追加
            if (data.root.directories) {
              for (const dirName in data.root.directories) {
                const dir = data.root.directories[dirName];
                const dirNode = { name: dirName, type: "directory", children: [] };
                
                // サブディレクトリとファイルを再帰的に追加
                addDirectoryContents(dir, dirNode);
                root.children.push(dirNode);
              }
            }
            
            // ルートディレクトリ直下のファイルを追加
            if (data.root.files) {
              data.root.files.forEach(file => {
                // ファイルの全プロパティを保持
                const fileNode = {
                  name: file.name,
                  path: file.path,
                  type: "file",
                  description: file.fileDescription || null,
                };
                
                // その他すべてのプロパティをコピー
                for (const key in file) {
                  if (key !== "name" && key !== "path" && key !== "fileDescription") {
                    fileNode[key] = file[key];
                  }
                }
                
                root.children.push(fileNode);
              });
            }
            
            return root;
          }
          
          // ディレクトリの内容を再帰的に追加する関数
          function addDirectoryContents(dir, parentNode) {
            // サブディレクトリを追加
            if (dir.directories) {
              for (const subDirName in dir.directories) {
                const subDir = dir.directories[subDirName];
                const subDirNode = { name: subDirName, type: "directory", children: [] };
                
                addDirectoryContents(subDir, subDirNode);
                parentNode.children.push(subDirNode);
              }
            }
            
            // ファイルを追加
            if (dir.files) {
              dir.files.forEach(file => {
                // ファイルの全プロパティを保持
                const fileNode = {
                  name: file.name,
                  path: file.path,
                  type: "file",
                  description: file.fileDescription || null,
                };
                
                // その他すべてのプロパティをコピー
                for (const key in file) {
                  if (key !== "name" && key !== "path" && key !== "fileDescription") {
                    fileNode[key] = file[key];
                  }
                }
                
                parentNode.children.push(fileNode);
              });
            }
          }
          
          // 階層データを作成
          const hierarchyData = convertToHierarchy(projectData);
          
          // D3の階層構造を生成
          const root = d3.hierarchy(hierarchyData);
          
          // ツリーレイアウトを適用
          tree(root);
          
          // リンク（線）の描画
          const link = g.selectAll(".link")
            .data(root.links())
            .enter().append("path")
            .attr("class", "link")
            .attr("d", d3.linkHorizontal()
              .x(d => d.y)
              .y(d => d.x));
          
          // ノードの描画
          const node = g.selectAll(".node")
            .data(root.descendants())
            .enter().append("g")
            .attr("class", d => "node " + (d.data.type === "file" ? "node-file" : "node-directory"))
            .attr("transform", d => \`translate(\${d.y},\${d.x})\`);
          
          // ノードの円を描画
          node.append("circle")
            .attr("r", d => d.data.type === "directory" ? 10 : 7)
            .attr("title", d => d.data.name);
          
          // ノードのテキストを描画
          node.append("text")
            .attr("dy", 3)
            .attr("x", d => d.children ? -15 : 15)
            .style("text-anchor", d => d.children ? "end" : "start")
            .text(d => d.data.name)
            .style("font-size", "12px");
          
          // マウスイベントの設定
          node.on("mouseover", function(event, d) {
            // ノードをハイライト
            d3.select(this).select("circle")
              .transition()
              .duration(200)
              .attr("r", d.data.type === "directory" ? 12 : 9);
            
            // ノードの種類に応じてツールチップの内容を変更
            let tooltipContent = "";
            
            if (d.data.type === "file") {
              // ファイルノードの場合は、すべてのプロパティを表示
              tooltipContent = \`
                <strong>\${d.data.name}</strong><br/>
                <small>\${d.data.path}</small><br/>
              \`;
              
              // 説明がある場合は追加
              if (d.data.description) {
                tooltipContent += \`<div style="margin-top: 8px;"><strong>説明:</strong><br/>\${d.data.description}</div>\`;
              }
              
              // 外部インポートがある場合は追加
              if (d.data.externalImports && d.data.externalImports.length > 0) {
                tooltipContent += \`
                  <div style="margin-top: 8px;">
                    <strong>外部インポート:</strong>
                    <ul style="margin: 5px 0; padding-left: 20px;">
                      \${d.data.externalImports.map(imp => \`<li>\${imp}</li>\`).join("")}
                    </ul>
                  </div>
                \`;
              }
              
              // 内部インポートがある場合は追加
              if (d.data.internalImports && d.data.internalImports.length > 0) {
                tooltipContent += \`
                  <div style="margin-top: 8px;">
                    <strong>内部インポート:</strong>
                    <ul style="margin: 5px 0; padding-left: 20px;">
                      \${d.data.internalImports.map(imp => \`<li>\${imp}</li>\`).join("")}
                    </ul>
                  </div>
                \`;
              }
              
              // 関数がある場合は追加
              if (d.data.functions && d.data.functions.length > 0) {
                tooltipContent += \`
                  <div style="margin-top: 8px;">
                    <strong>関数:</strong>
                    <ul style="margin: 5px 0; padding-left: 20px;">
                      \${d.data.functions.map(func => {
                        let funcDetails = \`<li><code>\${func.name}</code>\`;
                        if (func.description) {
                          funcDetails += \` - \${func.description}\`;
                        }
                        funcDetails += \`</li>\`;
                        return funcDetails;
                      }).join("")}
                    </ul>
                  </div>
                \`;
              }
              
              // その他のプロパティがあれば追加（上記以外のプロパティを検出して表示）
              const knownProps = ["name", "path", "type", "description", "externalImports", "internalImports", "functions", "children"];
              const otherProps = Object.keys(d.data).filter(key => !knownProps.includes(key));
              
              if (otherProps.length > 0) {
                tooltipContent += \`
                  <div style="margin-top: 8px;">
                    <strong>その他のプロパティ:</strong>
                    <ul style="margin: 5px 0; padding-left: 20px;">
                      \${otherProps.map(key => {
                        const value = typeof d.data[key] === 'object' ? JSON.stringify(d.data[key], null, 2) : d.data[key];
                        return \`<li>\${key}: \${value}</li>\`;
                      }).join("")}
                    </ul>
                  </div>
                \`;
              }
            } else if (d.data.type === "directory") {
              // ディレクトリノードの場合は、名前と情報を表示
              tooltipContent = \`
                <strong>\${d.data.name} (ディレクトリ)</strong><br/>
                <small>子要素数: \${d.children ? d.children.length : 0}</small>
              \`;
            } else {
              // その他のノードタイプの場合
              tooltipContent = \`<strong>\${d.data.name}</strong>\`;
            }
            
            // ツールチップを表示
            tooltip.transition()
              .duration(200)
              .style("opacity", .9);
            
            tooltip.html(tooltipContent)
              .style("left", (event.pageX + 10) + "px")
              .style("top", (event.pageY - 28) + "px");
          })
          .on("mouseout", function(event, d) {
            // ハイライトを元に戻す
            d3.select(this).select("circle")
              .transition()
              .duration(200)
              .attr("r", d.data.type === "directory" ? 10 : 7);
              
            tooltip.transition()
              .duration(500)
              .style("opacity", 0);
          });
          
          // コントロールボタンの機能実装
          const zoom = d3.zoom().on("zoom", (event) => {
            g.attr("transform", event.transform);
          });
          
          d3.select("#zoomIn").on("click", function() {
            svg.transition().call(zoom.scaleBy, 1.3);
          });
          
          d3.select("#zoomOut").on("click", function() {
            svg.transition().call(zoom.scaleBy, 0.7);
          });
          
          d3.select("#resetZoom").on("click", function() {
            svg.transition().call(zoom.transform, d3.zoomIdentity);
          });
          
          // 初期位置を調整（全体が見えるように）
          const initialScale = 0.6;
          svg.call(zoom.transform, d3.zoomIdentity
            .translate(width / 5, 20)
            .scale(initialScale));
          
          // VSCodeへのメッセージ送信関数
          const vscode = acquireVsCodeApi();
          function sendMessage(message) {
            vscode.postMessage(message);
          }
        })();
      </script>
    </body>
    </html>
  `;
}

// コード解析関数
async function analyzeCode(rootPath: string): Promise<any> {
  // ts-morphプロジェクトの初期化
  const project = new Project();

  // gitignoreを読み込み、ignoreインスタンスを作成
  const ig = ignore();

  // 常に除外すべきパターン
  ig.add(["node_modules", "dist", "out", "build", ".git"]);

  // .gitignoreファイルが存在する場合は読み込む
  const gitignorePath = path.join(rootPath, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    ig.add(gitignoreContent);
  }

  // 検索対象の拡張子
  const extensions = [".ts", ".tsx", ".js", ".jsx"];

  // プロジェクト内のすべてのファイルを取得
  const allFiles: string[] = [];
  const findFiles = (dir: string) => {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      const relativePath = path.relative(rootPath, fullPath);

      // gitignoreルールに基づいて除外判定
      if (ig.ignores(relativePath.replace(/\\/g, "/"))) {
        continue;
      }

      if (file.isDirectory()) {
        findFiles(fullPath);
      } else if (extensions.some((ext) => file.name.endsWith(ext))) {
        allFiles.push(fullPath);
      }
    }
  };

  try {
    findFiles(rootPath);
  } catch (error) {
    console.error("ファイル検索中にエラーが発生しました:", error);
  }

  // ファイルをプロジェクトに追加
  allFiles.forEach((file) => {
    project.addSourceFileAtPath(file);
  });

  // プロジェクト構造の解析結果
  const projectStructure: any = {
    root: {
      path: rootPath,
      files: [],
      directories: {},
    },
  };

  // 各ファイルを解析
  const sourceFiles = project.getSourceFiles();
  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(rootPath, filePath);

    // ファイル情報を収集
    const fileInfo = analyzeFile(sourceFile, rootPath);

    // ディレクトリ階層に追加
    addFileToStructure(
      projectStructure.root,
      relativePath.split(path.sep),
      fileInfo
    );
  }

  // 空のディレクトリやファイル配列を削除
  cleanupEmptyCollections(projectStructure.root);

  return projectStructure;
}

// 空のディレクトリやファイル配列を削除する関数
function cleanupEmptyCollections(node: any): void {
  // filesが空配列なら削除
  if (Array.isArray(node.files) && node.files.length === 0) {
    delete node.files;
  }

  // directoriesが空オブジェクトなら削除
  if (node.directories && Object.keys(node.directories).length === 0) {
    delete node.directories;
  } else if (node.directories) {
    // 各サブディレクトリに対して再帰的に処理
    for (const dirName in node.directories) {
      cleanupEmptyCollections(node.directories[dirName]);
    }
  }
}

// ファイル解析関数
function analyzeFile(sourceFile: SourceFile, rootPath: string): any {
  const filePath = sourceFile.getFilePath();
  const relativePath = path.relative(rootPath, filePath);

  // ファイルの基本情報
  const fileInfo: any = {
    name: path.basename(filePath),
    path: relativePath,
  };

  // ファイル先頭のコメントを取得（use client/use serverを除く）
  const fileDescription = getFileDescription(sourceFile);
  if (fileDescription) {
    fileInfo.fileDescription = fileDescription;
  }

  // import文の解析（情報を圧縮）
  const externalImports: string[] = [];
  const internalImports: string[] = [];

  sourceFile.getImportDeclarations().forEach((importDecl) => {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // NextJSのルールに基づいて振り分け
    if (
      moduleSpecifier.startsWith(".") ||
      moduleSpecifier.startsWith("/") ||
      moduleSpecifier.startsWith("@/")
    ) {
      internalImports.push(moduleSpecifier);
    } else {
      externalImports.push(moduleSpecifier);
    }
  });

  // 空配列は含めない
  if (externalImports.length > 0) {
    fileInfo.externalImports = externalImports;
  }

  if (internalImports.length > 0) {
    fileInfo.internalImports = internalImports;
  }

  // 関数宣言の解析
  const functions: any[] = [];
  collectFunctions(sourceFile, functions);

  // 関数が見つかった場合のみ含める
  if (functions.length > 0) {
    fileInfo.functions = functions;
  }

  return fileInfo;
}

// ディレクトリ階層にファイル情報を追加する関数
function addFileToStructure(
  current: any,
  pathParts: string[],
  fileInfo: any
): void {
  if (pathParts.length === 1) {
    // 最後のパスパーツがファイル名の場合は、filesに追加
    if (!current.files) {
      current.files = [];
    }
    current.files.push(fileInfo);
    return;
  }

  const dirName = pathParts[0];
  if (!current.directories) {
    current.directories = {};
  }

  if (!current.directories[dirName]) {
    current.directories[dirName] = {
      name: dirName,
      files: [],
      directories: {},
    };
  }

  // 再帰的に次のディレクトリレベルに移動
  addFileToStructure(
    current.directories[dirName],
    pathParts.slice(1),
    fileInfo
  );
}

// ファイル先頭のコメントを取得（use client/use serverを除く）
function getFileDescription(sourceFile: SourceFile): string | undefined {
  const leadingComments: string[] = [];

  // ファイルの最初のステートメントを取得
  const statements = sourceFile.getStatements();
  if (statements.length === 0) {
    return undefined;
  }

  // 最初のステートメントの前のコメントを取得
  const firstStatement = statements[0];
  const commentRanges = firstStatement.getLeadingCommentRanges();

  for (const commentRange of commentRanges) {
    const commentText = commentRange.getText();
    // use client/use serverを除外
    if (
      !commentText.includes("use client") &&
      !commentText.includes("use server")
    ) {
      const cleanComment = commentText
        .replace(/\/\*\*/g, "") // JSDocの開始記号を削除
        .replace(/\*\//g, "") // JSDocの終了記号を削除
        .replace(/\*/g, "") // 行頭の*を削除
        .replace(/\/\//g, "") // 行コメントの//を削除
        .split("\n") // 行ごとに分割
        .map((line) => line.trim()) // 各行をトリム
        .filter((line) => line.length > 0) // 空行を除去
        .join("\n"); // 再結合

      if (cleanComment.trim()) {
        leadingComments.push(cleanComment.trim());
      }
    }
  }

  return leadingComments.length > 0 ? leadingComments.join("\n") : undefined;
}

// 関数を収集する関数
function collectFunctions(sourceFile: SourceFile, functionsArray: any[]): void {
  // 関数宣言を収集
  sourceFile.getFunctions().forEach((func) => {
    processFunction(func, functionsArray);
  });

  // 変数定義の中のアロー関数と関数式を収集
  sourceFile.getVariableDeclarations().forEach((varDecl) => {
    const initializer = varDecl.getInitializer();
    if (initializer) {
      if (initializer.getKind() === SyntaxKind.ArrowFunction) {
        processFunction(
          initializer as ArrowFunction,
          functionsArray,
          varDecl.getName()
        );
      } else if (initializer.getKind() === SyntaxKind.FunctionExpression) {
        processFunction(
          initializer as FunctionExpression,
          functionsArray,
          varDecl.getName()
        );
      }
    }
  });

  // クラスメソッドを収集
  sourceFile.getClasses().forEach((cls) => {
    cls.getMethods().forEach((method) => {
      processFunction(
        method,
        functionsArray,
        `${cls.getName()}.${method.getName()}`
      );
    });
  });
}

// 関数情報を処理する関数
function processFunction(
  func: FunctionDeclaration | ArrowFunction | FunctionExpression | any,
  functionsArray: any[],
  variableName?: string
): void {
  // 関数名の取得（アロー関数や関数式の場合は変数名を使用）
  let functionName = variableName || "";
  if ("getName" in func && typeof func.getName === "function") {
    const name = func.getName();
    if (name) {
      functionName = name;
    }
  }

  // 無名関数の場合はスキップ
  if (!functionName) {
    return;
  }

  // 関数の基本情報
  const functionInfo: any = {
    name: functionName,
  };

  // JSDocコメントの取得
  if ("getJsDocs" in func && typeof func.getJsDocs === "function") {
    const jsDocs = func.getJsDocs();
    if (jsDocs.length > 0) {
      const jsDoc = jsDocs[0] as JSDoc;
      const description = jsDoc.getDescription()?.trim();
      if (description) {
        functionInfo.description = description;
      }

      // パラメータタグの取得
      const params: any[] = [];
      jsDoc.getTags().forEach((tag) => {
        if (tag.getTagName() === "param") {
          const paramText = tag.getText();
          const paramDescription = tag.getComment();

          // JSDocのパラメータコメントからパラメータ名と型を抽出する
          // 例: @param {string} name - 説明文
          const paramMatch = paramText.match(
            /@param\s+(?:{([^}]+)})?\s*(\w+)(?:\s*-\s*(.+))?/
          );

          if (paramMatch) {
            const [, paramType, paramName, paramDesc] = paramMatch;
            params.push({
              name: paramName,
              type: paramType,
              description: paramDesc || paramDescription || undefined,
            });
          }
        } else if (
          tag.getTagName() === "returns" ||
          tag.getTagName() === "return"
        ) {
          const returnText = tag.getText();
          const returnDescription = tag.getComment();

          // JSDocのリターンコメントから型を抽出する
          // 例: @returns {string} 説明文
          const returnMatch = returnText.match(
            /@returns?\s+(?:{([^}]+)})?\s*(.*)/
          );

          if (returnMatch) {
            const [, returnType, returnDesc] = returnMatch;
            functionInfo.returns = {
              type: returnType || undefined,
              description: returnDesc || returnDescription || undefined,
            };
          } else if (returnDescription) {
            functionInfo.returns = {
              description: returnDescription,
            };
          }
        }
      });

      // パラメータが見つかった場合のみ含める
      if (params.length > 0) {
        functionInfo.params = params;
      }
    }
  }

  functionsArray.push(functionInfo);
}

// 拡張機能の非アクティベート関数（クリーンアップ）
export function deactivate() {}
