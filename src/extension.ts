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
  VariableDeclaration,
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

  // D3.js可視化コマンドの登録
  const d3VisCommand = vscode.commands.registerCommand(
    "code-is-document.showMermaidDiagram", // コマンド名はそのまま
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

        // D3.js用データ構造に変換
        const d3Data = generateD3Data(result);

        // D3.jsで可視化
        showD3Visualization(context.extensionUri, d3Data);
      } catch (error) {
        vscode.window.showErrorMessage(`エラーが発生しました: ${error}`);
      }
    }
  );

  context.subscriptions.push(dependenciesCommand, d3VisCommand);
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

// D3.js用のデータ構造を生成する関数
function generateD3Data(projectStructure: any): any {
  const nodes: any[] = [];
  const links: any[] = [];
  const nodeMap = new Map<string, number>(); // パスからインデックスへのマッピング

  // ノードを生成する再帰関数
  function processNode(
    node: any,
    parentIndex: number | null = null,
    nodePath: string = "",
    depth: number = 0
  ) {
    // このノードのインデックス
    const currentIndex = nodes.length;

    // パスをインデックスにマッピング
    if (nodePath) {
      nodeMap.set(nodePath, currentIndex);
    }

    if (node.name) {
      // ノード情報を作成
      const nodeInfo: any = {
        id: currentIndex,
        name: node.name,
        isDirectory: !!node.directories,
        depth: depth,
      };

      // ファイルの説明がある場合は追加
      if (node.fileDescription) {
        nodeInfo.description = node.fileDescription;
      }

      // 関数数を追加
      if (node.functions && node.functions.length > 0) {
        nodeInfo.functions = node.functions.length;
      }

      // ノードリストに追加
      nodes.push(nodeInfo);

      // 親が存在する場合はリンクを追加
      if (parentIndex !== null) {
        links.push({
          source: parentIndex,
          target: currentIndex,
          type: "hierarchy",
        });
      }

      // 内部インポートの依存関係を追加
      if (node.internalImports && node.internalImports.length > 0) {
        node.internalImports.forEach((importPath: string) => {
          // 相対パスを解決
          let resolvedPath = importPath;
          if (importPath.startsWith(".")) {
            const dir = path.dirname(nodePath);
            resolvedPath = path.normalize(path.join(dir, importPath));
            if (!path.extname(resolvedPath)) {
              const extensions = [".ts", ".tsx", ".js", ".jsx"];
              for (const ext of extensions) {
                const pathWithExt = resolvedPath + ext;
                if (nodeMap.has(pathWithExt) || fs.existsSync(pathWithExt)) {
                  resolvedPath = pathWithExt;
                  break;
                }
              }
            }
          } else if (importPath.startsWith("@/")) {
            resolvedPath = importPath.replace("@/", "src/");
            if (!path.extname(resolvedPath)) {
              const extensions = [".ts", ".tsx", ".js", ".jsx"];
              for (const ext of extensions) {
                const pathWithExt = resolvedPath + ext;
                if (nodeMap.has(pathWithExt) || fs.existsSync(pathWithExt)) {
                  resolvedPath = pathWithExt;
                  break;
                }
              }
            }
          }

          // 依存関係情報を保存
          links.push({
            source: currentIndex,
            target: resolvedPath,
            type: "dependency",
            isResolved: false,
          });
        });
      }
    }

    // サブディレクトリを処理
    if (node.directories) {
      for (const dirName in node.directories) {
        const childPath = nodePath ? path.join(nodePath, dirName) : dirName;
        processNode(
          node.directories[dirName],
          currentIndex,
          childPath,
          depth + 1
        );
      }
    }

    // ファイルを処理
    if (node.files && node.files.length > 0) {
      node.files.forEach((file: any) => {
        const filePath = file.path;
        processNode(file, currentIndex, filePath, depth + 1);
      });
    }
  }

  // ルートから処理開始
  processNode(projectStructure.root);

  // 依存関係リンクを解決
  const resolvedLinks = links.filter((link) => {
    if (link.type === "hierarchy" || link.isResolved) {
      return true;
    }

    // 文字列のターゲットをノードインデックスに解決
    if (typeof link.target === "string") {
      const targetIndex = nodeMap.get(link.target);
      if (targetIndex !== undefined) {
        link.target = targetIndex;
        link.isResolved = true;
        return true;
      }
    }

    return false;
  });

  return { nodes, links: resolvedLinks };
}

// D3.jsでの可視化を表示する関数
function showD3Visualization(extensionUri: vscode.Uri, data: any) {
  const panel = vscode.window.createWebviewPanel(
    "d3Visualization",
    "Code Structure with D3.js",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  panel.webview.html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>コード構造図</title>
      <script src="https://d3js.org/d3.v7.min.js"></script>
      <style>
        body { 
          font-family: sans-serif; 
          margin: 0;
          overflow: hidden;
        }
        .container {
          position: relative;
          width: 100vw;
          height: 100vh;
        }
        .controls {
          position: absolute;
          top: 10px;
          left: 10px;
          z-index: 10;
          background: rgba(255, 255, 255, 0.8);
          padding: 10px;
          border-radius: 5px;
        }
        .node {
          cursor: pointer;
        }
        .link {
          stroke-width: 1.5px;
        }
        .directory {
          fill: #ffd700;
        }
        .file {
          fill: #add8e6;
        }
        .tooltip {
          position: absolute;
          background: white;
          border: 1px solid #ccc;
          border-radius: 5px;
          padding: 10px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.3s;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="controls">
          <button id="zoomIn">拡大</button>
          <button id="zoomOut">縮小</button>
          <button id="reset">リセット</button>
          <select id="layout">
            <option value="force">力学的レイアウト</option>
            <option value="radial">放射状レイアウト</option>
            <option value="tree">ツリーレイアウト</option>
          </select>
        </div>
        <div id="tooltip" class="tooltip"></div>
        <svg id="visualization"></svg>
      </div>
      <script>
        // データを初期化
        const data = ${JSON.stringify(data)};
        
        // SVG要素のサイズを設定
        const width = window.innerWidth;
        const height = window.innerHeight;
        const svg = d3.select("#visualization")
          .attr("width", width)
          .attr("height", height);
        
        // ズーム機能
        const zoom = d3.zoom()
          .scaleExtent([0.1, 10])
          .on("zoom", zoomed);
        
        svg.call(zoom);
        
        // グラフコンテナ
        const g = svg.append("g");
        
        // ツールチップ
        const tooltip = d3.select("#tooltip");
        
        // ズーム処理関数
        function zoomed(event) {
          g.attr("transform", event.transform);
        }
        
        // ノードの色を決定
        function getNodeColor(d) {
          return d.isDirectory ? "#ffd700" : "#add8e6";
        }
        
        // ノード間を結ぶリンクの色を決定
        function getLinkColor(d) {
          return d.type === "hierarchy" ? "#999" : "#f00";
        }
        
        // リンクのスタイルを決定
        function getLinkStyle(d) {
          return d.type === "hierarchy" ? "" : "3,3";
        }
        
        // 力学的レイアウト
        function applyForceLayout() {
          // ノードとリンクの作成
          const nodes = data.nodes.map(d => Object.assign({}, d));
          const links = data.links.map(d => Object.assign({}, d));
          
          // シミュレーションの設定
          const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide().radius(50));
          
          // リンクの描画
          const link = g.selectAll(".link")
            .data(links)
            .join("line")
            .attr("class", "link")
            .attr("stroke", getLinkColor)
            .attr("stroke-dasharray", getLinkStyle);
          
          // ノードの描画
          const node = g.selectAll(".node")
            .data(nodes)
            .join("g")
            .attr("class", "node")
            .call(d3.drag()
              .on("start", dragstarted)
              .on("drag", dragged)
              .on("end", dragended));
          
          // ノードの円を追加
          node.append("circle")
            .attr("r", d => d.isDirectory ? 15 : 8)
            .attr("fill", getNodeColor)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);
          
          // ノードのラベルを追加
          node.append("text")
            .attr("dy", 25)
            .attr("text-anchor", "middle")
            .text(d => d.name)
            .style("font-size", "10px")
            .style("pointer-events", "none");
          
          // ツールチップの処理
          node.on("mouseover", function(event, d) {
            let content = \`<strong>\${d.name}</strong>\`;
            if (d.description) {
              content += \`<br>\${d.description}\`;
            }
            if (d.functions) {
              content += \`<br>関数数: \${d.functions}\`;
            }
            
            tooltip
              .html(content)
              .style("left", (event.pageX + 10) + "px")
              .style("top", (event.pageY - 10) + "px")
              .style("opacity", 1);
          })
          .on("mouseout", function() {
            tooltip.style("opacity", 0);
          });
          
          // シミュレーションの更新
          simulation.on("tick", () => {
            link
              .attr("x1", d => d.source.x)
              .attr("y1", d => d.source.y)
              .attr("x2", d => d.target.x)
              .attr("y2", d => d.target.y);
            
            node.attr("transform", d => \`translate(\${d.x},\${d.y})\`);
          });
          
          // ドラッグ関連の関数
          function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          }
          
          function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
          }
          
          function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }
          
          return simulation;
        }
        
        // 放射状レイアウト
        function applyRadialLayout() {
          g.selectAll("*").remove();
          
          const radius = Math.min(width, height) / 2 - 100;
          const rootNode = data.nodes[0];
          
          // 階層構造を構築
          const hierarchyData = d3.stratify()
            .id(d => d.id)
            .parentId(d => {
              const parentLink = data.links.find(link => 
                link.type === "hierarchy" && link.target === d.id
              );
              return parentLink ? parentLink.source : null;
            })
            (data.nodes);
          
          // レイアウトの計算
          const radialLayout = d3.tree()
            .size([2 * Math.PI, radius])
            .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);
          
          const rootLayout = radialLayout(hierarchyData);
          
          // リンクの描画
          g.selectAll(".link")
            .data(rootLayout.links())
            .join("path")
            .attr("class", "link")
            .attr("d", d3.linkRadial()
              .angle(d => d.x)
              .radius(d => d.y))
            .attr("fill", "none")
            .attr("stroke", "#999");
          
          // 依存関係リンクを追加
          const dependencyLinks = data.links.filter(d => d.type === "dependency");
          if (dependencyLinks.length > 0) {
            // 依存関係の座標を計算
            const nodePositions = {};
            rootLayout.each(node => {
              nodePositions[node.id] = {
                x: node.x,
                y: node.y
              };
            });
            
            g.selectAll(".dependency")
              .data(dependencyLinks)
              .join("path")
              .attr("class", "dependency")
              .attr("d", d => {
                const sourcePos = nodePositions[d.source];
                const targetPos = nodePositions[d.target];
                if (sourcePos && targetPos) {
                  const sourceX = sourcePos.y * Math.cos(sourcePos.x) + width / 2;
                  const sourceY = sourcePos.y * Math.sin(sourcePos.x) + height / 2;
                  const targetX = targetPos.y * Math.cos(targetPos.x) + width / 2;
                  const targetY = targetPos.y * Math.sin(targetPos.x) + height / 2;
                  return \`M\${sourceX},\${sourceY}L\${targetX},\${targetY}\`;
                }
                return "";
              })
              .attr("fill", "none")
              .attr("stroke", "#f00")
              .attr("stroke-dasharray", "3,3");
          }
          
          // ノードを描画
          const node = g.selectAll(".node")
            .data(rootLayout.descendants())
            .join("g")
            .attr("class", "node")
            .attr("transform", d => \`translate(\${d.y * Math.cos(d.x) + width / 2},\${d.y * Math.sin(d.x) + height / 2})\`);
          
          // ノードの円を追加
          node.append("circle")
            .attr("r", d => d.data.isDirectory ? 12 : 6)
            .attr("fill", d => d.data.isDirectory ? "#ffd700" : "#add8e6");
          
          // ノードのラベルを追加
          node.append("text")
            .attr("dy", 20)
            .attr("text-anchor", "middle")
            .text(d => d.data.name)
            .style("font-size", "9px");
          
          // ツールチップの処理
          node.on("mouseover", function(event, d) {
            let content = \`<strong>\${d.data.name}</strong>\`;
            if (d.data.description) {
              content += \`<br>\${d.data.description}\`;
            }
            if (d.data.functions) {
              content += \`<br>関数数: \${d.data.functions}\`;
            }
            
            tooltip
              .html(content)
              .style("left", (event.pageX + 10) + "px")
              .style("top", (event.pageY - 10) + "px")
              .style("opacity", 1);
          })
          .on("mouseout", function() {
            tooltip.style("opacity", 0);
          });
        }
        
        // ツリーレイアウト
        function applyTreeLayout() {
          g.selectAll("*").remove();
          
          // 階層構造を構築
          const hierarchyData = d3.stratify()
            .id(d => d.id)
            .parentId(d => {
              const parentLink = data.links.find(link => 
                link.type === "hierarchy" && link.target === d.id
              );
              return parentLink ? parentLink.source : null;
            })
            (data.nodes);
          
          // レイアウトの計算
          const treeLayout = d3.tree()
            .size([height - 100, width - 200]);
          
          const rootLayout = treeLayout(hierarchyData);
          
          // リンクの描画
          g.selectAll(".link")
            .data(rootLayout.links())
            .join("path")
            .attr("class", "link")
            .attr("d", d3.linkHorizontal()
              .x(d => d.y)
              .y(d => d.x))
            .attr("fill", "none")
            .attr("stroke", "#999");
          
          // 依存関係リンクを追加
          const dependencyLinks = data.links.filter(d => d.type === "dependency");
          if (dependencyLinks.length > 0) {
            // 依存関係の座標を計算
            const nodePositions = {};
            rootLayout.each(node => {
              nodePositions[node.id] = {
                x: node.x,
                y: node.y
              };
            });
            
            g.selectAll(".dependency")
              .data(dependencyLinks)
              .join("path")
              .attr("class", "dependency")
              .attr("d", d => {
                const sourcePos = nodePositions[d.source];
                const targetPos = nodePositions[d.target];
                if (sourcePos && targetPos) {
                  return \`M\${sourcePos.y},\${sourcePos.x}C\${(sourcePos.y + targetPos.y) / 2},\${sourcePos.x} \${(sourcePos.y + targetPos.y) / 2},\${targetPos.x} \${targetPos.y},\${targetPos.x}\`;
                }
                return "";
              })
              .attr("fill", "none")
              .attr("stroke", "#f00")
              .attr("stroke-dasharray", "3,3");
          }
          
          // ノードを描画
          const node = g.selectAll(".node")
            .data(rootLayout.descendants())
            .join("g")
            .attr("class", "node")
            .attr("transform", d => \`translate(\${d.y},\${d.x})\`);
          
          // ノードの円を追加
          node.append("circle")
            .attr("r", d => d.data.isDirectory ? 12 : 6)
            .attr("fill", d => d.data.isDirectory ? "#ffd700" : "#add8e6");
          
          // ノードのラベルを追加
          node.append("text")
            .attr("dy", 3)
            .attr("x", d => d.children ? -15 : 15)
            .attr("text-anchor", d => d.children ? "end" : "start")
            .text(d => d.data.name)
            .style("font-size", "10px");
          
          // ツールチップの処理
          node.on("mouseover", function(event, d) {
            let content = \`<strong>\${d.data.name}</strong>\`;
            if (d.data.description) {
              content += \`<br>\${d.data.description}\`;
            }
            if (d.data.functions) {
              content += \`<br>関数数: \${d.data.functions}\`;
            }
            
            tooltip
              .html(content)
              .style("left", (event.pageX + 10) + "px")
              .style("top", (event.pageY - 10) + "px")
              .style("opacity", 1);
          })
          .on("mouseout", function() {
            tooltip.style("opacity", 0);
          });
        }
        
        // 初期レイアウトとして力学的レイアウトを適用
        let currentSimulation = applyForceLayout();
        
        // レイアウト切り替え処理
        d3.select("#layout").on("change", function() {
          const layout = this.value;
          if (currentSimulation) {
            currentSimulation.stop();
          }
          g.selectAll("*").remove();
          
          if (layout === "force") {
            currentSimulation = applyForceLayout();
          } else if (layout === "radial") {
            applyRadialLayout();
            currentSimulation = null;
          } else if (layout === "tree") {
            applyTreeLayout();
            currentSimulation = null;
          }
        });
        
        // ズームコントロール
        d3.select("#zoomIn").on("click", function() {
          svg.transition().call(zoom.scaleBy, 1.5);
        });
        
        d3.select("#zoomOut").on("click", function() {
          svg.transition().call(zoom.scaleBy, 0.75);
        });
        
        d3.select("#reset").on("click", function() {
          svg.transition().call(zoom.transform, d3.zoomIdentity);
        });
        
        // ウィンドウリサイズ処理
        window.addEventListener("resize", function() {
          const width = window.innerWidth;
          const height = window.innerHeight;
          svg.attr("width", width).attr("height", height);
          
          // レイアウトの再適用
          const layout = document.getElementById("layout").value;
          if (layout === "force" && currentSimulation) {
            currentSimulation.force("center", d3.forceCenter(width / 2, height / 2));
            currentSimulation.alpha(0.3).restart();
          } else if (layout === "radial") {
            applyRadialLayout();
          } else if (layout === "tree") {
            applyTreeLayout();
          }
        });
      </script>
    </body>
    </html>
  `;
}

// 拡張機能の非アクティベート関数（クリーンアップ）
export function deactivate() {}
