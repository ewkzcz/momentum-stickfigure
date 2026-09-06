/**
 * 字体服务模块
 * 用于获取系统所有可用字体
 */

import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)

/**
 * Windows 系统：通过注册表获取字体
 * 处理流程：
 * 1、读取系统与用户字体注册表，规范字体族名称。
 * 2、必要时使用命令行回退，并补齐常见中英文别名。
 * 3、合并字体目录扫描结果，排序返回去重列表。
 */
async function getWindowsFonts() {
  try {
    // 1、准备字体名称规范化逻辑。
    /**
     * 将注册表属性名转换为字体族集合。
     * 处理流程：
     * 1、移除格式说明和明确的样式后缀。
     * 2、拆分多个字体族并去重收集。
     */
    const parseRegistryPropertyNames = (propArray) => {
      // 1、准备去重集合及名称清理规则。
      const fontSet = new Set()
      const styleSuffix = /(Bold|Italic|Regular|Light|Medium|SemiBold|Black|Thin|ExtraLight|ExtraBold|Heavy)$/i
      const removeParenSuffix = /\s*\([^)]*\)$/ // 移除任意括号说明，如 (TrueType)/(OpenType)

      /**
       * 将单条注册表名称加入字体集合。
       * 处理流程：
       * 1、去除括号说明并拆分多个族名。
       * 2、裁剪独立样式后缀后写入集合。
       */
      const pushName = (rawName) => {
        // 1、过滤空名称并清理格式说明。
        if (!rawName) return
        // 去掉括号后缀
        let name = String(rawName).replace(removeParenSuffix, '').trim()
        if (!name) return
        // 按 & 或 , 分割多个族名
        const parts = name.split(/\s*&\s*|\s*,\s*/).map(s => s.trim()).filter(Boolean)
        // 2、逐个字体族规范空白和样式后缀。
        for (const part of parts) {
          let fam = part
          // 对明显样式后缀进行温和裁剪：仅当有空格分隔且去掉后仍有有效名称
          const tokens = fam.split(/\s+/)
          if (tokens.length > 1 && styleSuffix.test(tokens[tokens.length - 1])) {
            const maybeBase = tokens.slice(0, -1).join(' ')
            if (maybeBase && maybeBase.length >= 2) {
              fam = maybeBase
            }
          }
          fam = fam.replace(/\s+/g, ' ').trim()
          if (fam) fontSet.add(fam)
        }
      }

      // 2、逐条收集注册表名称。
      for (const propName of Array.isArray(propArray) ? propArray : []) {
        pushName(propName)
      }
      return fontSet
    }

    /**
     * 读取指定注册表根键的字体属性。
     * 处理流程：
     * 1、用 PowerShell 导出字体属性名为 JSON。
     * 2、解析输出，格式异常时返回空列表。
     */
    const psReadProps = async (hive) => {
      // 1、执行注册表读取并解析 JSON 输出。
      const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p='${hive}:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'; if (Test-Path $p) { (Get-Item $p).Property | ConvertTo-Json -Compress } else { '[]' }"`
      const { stdout } = await execAsync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
      try {
        return JSON.parse(stdout)
      } catch {
        return []
      }
    }

    // 2、并行读取系统与用户字体注册表并合并。
    const [hklmProps, hkcuProps] = await Promise.all([
      psReadProps('HKLM'),
      psReadProps('HKCU')
    ])

    let fontSet = new Set()
    const setLM = parseRegistryPropertyNames(hklmProps)
    const setCU = parseRegistryPropertyNames(hkcuProps)
    setLM.forEach(f => fontSet.add(f))
    setCU.forEach(f => fontSet.add(f))

    /**
     * 使用注册表命令补充字体列表。
     * 处理流程：
     * 1、解析命令输出中的字体格式标记。
     * 2、查询系统与用户注册表并合并字体名称。
     */
    const ensureWithRegQuery = async () => {
      /**
       * 解析注册表命令输出。
       * 处理流程：
       * 1、逐行提取字体名并复用名称规范化逻辑。
       */
      const parseRegBlock = (text) => {
        // 1、筛选带字体格式后缀的条目并去重。
        const set = new Set()
        const lines = String(text || '').split(/\r?\n/)
        for (const line of lines) {
          const m = line.match(/^\s*([^\r\n]+?)\s+\((TrueType|OpenType|PostScript|Type1|Type\s*1)\)/i)
          if (m) {
            const name = m[1]
            // 复用解析逻辑
            const tmp = parseRegistryPropertyNames([name])
            tmp.forEach(n => set.add(n))
          }
        }
        return set
      }

      // 1、读取两处注册表，解析结果后合并到字体集合。
      const { stdout: outLM } = await execAsync('chcp 65001 >nul & reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /s', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
      const { stdout: outCU } = await execAsync('chcp 65001 >nul & reg query "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /s', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
      const add1 = parseRegBlock(outLM)
      const add2 = parseRegBlock(outCU)
      add1.forEach(f => fontSet.add(f))
      add2.forEach(f => fontSet.add(f))
    }

    if (fontSet.size === 0) {
      try { await ensureWithRegQuery() } catch {}
    }

    /**
     * 扩充常见字体的中英文别名。
     * 处理流程：
     * 1、检查已知别名对，为已存在的一侧补充另一侧。
     */
    const addCommonAliases = (set) => {
      // 1、仅为集合中已存在的字体补齐对应别名。
      const aliasPairs = [
        ['Microsoft YaHei', '微软雅黑'],
        ['Microsoft YaHei UI', '微软雅黑 UI'],
        ['DengXian', '等线'],
        ['YouYuan', '幼圆'],
        ['LiSu', '隶书'],
        ['SimSun', '宋体'],
        ['NSimSun', '新宋体'],
        ['SimHei', '黑体'],
        ['KaiTi', '楷体'],
        ['FangSong', '仿宋'],
        ['STZhongsong', '华文中宋'],
        ['STXingkai', '华文行楷'],
        ['STXinwei', '华文新魏'],
        ['STCaiyun', '华文彩云'],
        ['STHupo', '华文琥珀'],
        ['STLiti', '华文隶书'],
        ['STHeiti', '华文黑体'],
        ['STXihei', '华文细黑'],
        ['STKaiti', '华文楷体'],
        ['STSong', '华文宋体'],
        ['STFangsong', '华文仿宋'],
        ['Source Han Sans SC', '思源黑体'],
        ['Source Han Serif SC', '思源宋体'],
        ['Noto Sans CJK SC', 'Noto Sans SC'],
        ['Noto Serif CJK SC', 'Noto Serif SC']
      ]
      for (const [en, zh] of aliasPairs) {
        if (set.has(en) && !set.has(zh)) set.add(zh)
        if (set.has(zh) && !set.has(en)) set.add(en)
      }
    }
    addCommonAliases(fontSet)

    /**
     * 扫描 Windows 字体目录获取字体族。
     * 处理流程：
     * 1、用系统字体解析能力读取系统与用户字体文件。
     * 2、解析去重结果，扫描失败时返回空列表。
     */
    const scanFontDirs = async () => {
      // 1、通过 PowerShell 读取字体文件内部的字体族名称。
      try {
        const ps = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
          [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
          Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue | Out-Null;
          $dirs = @();
          if ($env:WINDIR) { $dirs += (Join-Path $env:WINDIR 'Fonts') }
          if ($env:LOCALAPPDATA) { $dirs += (Join-Path $env:LOCALAPPDATA 'Microsoft/Windows/Fonts') }
          $families = New-Object System.Collections.Generic.HashSet[string];
          foreach ($d in $dirs) {
            if (Test-Path $d) {
              Get-ChildItem -LiteralPath $d -File -Include *.ttf,*.otf,*.ttc,*.otc -ErrorAction SilentlyContinue | ForEach-Object {
                try {
                  $pfc = New-Object System.Drawing.Text.PrivateFontCollection;
                  $pfc.AddFontFile($_.FullName);
                  foreach ($fam in $pfc.Families) { if ($fam -and $fam.Name) { [void]$families.Add($fam.Name.Trim()) } }
                } catch {}
              }
            }
          }
          $out = [string[]]$families; $out | Sort-Object -Unique | ConvertTo-Json -Compress
        "`
        const { stdout } = await execAsync(ps, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
        const fams = JSON.parse(stdout)
        return Array.isArray(fams) ? fams : []
      } catch (e) {
        return []
      }
    }

    try {
      // 3、合并目录扫描结果，随后排序返回。
      const dirFamilies = await scanFontDirs()
      for (const f of dirFamilies) if (f && typeof f === 'string') fontSet.add(f)
    } catch {}

    const list = Array.from(fontSet)
      .map(s => s.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

    return list
  } catch (error) {
    console.error('获取 Windows 字体失败:', error)
    return []
  }
}

/**
 * macOS 系统：通过 system_profiler 获取字体
 * 处理流程：
 * 1、读取系统字体清单 JSON。
 * 2、收集名称并去重排序，失败时返回空列表。
 */
async function getMacFonts() {
  // 1、调用系统信息工具获取字体元数据。
  try {
    const { stdout } = await execAsync(
      'system_profiler SPFontsDataType -json',
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    )
    
    const data = JSON.parse(stdout)
    const fontSet = new Set()
    
    // 2、收集系统返回的字体名称。
    if (data.SPFontsDataType) {
      for (const font of data.SPFontsDataType) {
        if (font._name) {
          fontSet.add(font._name)
        }
      }
    }
    
    return Array.from(fontSet).sort()
  } catch (error) {
    console.error('获取 macOS 字体失败:', error)
    return []
  }
}

/**
 * Linux 系统：通过 fc-list 获取字体
 * 处理流程：
 * 1、运行字体族查询命令。
 * 2、拆分每行多个名称，去重排序后返回。
 */
async function getLinuxFonts() {
  // 1、获取字体族清单。
  try {
    const { stdout } = await execAsync(
      'fc-list : family',
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    )
    
    const lines = stdout.split('\n')
    const fontSet = new Set()
    
    // 2、拆分每行逗号分隔的字体族并去重。
    for (const line of lines) {
      if (line.trim()) {
        // fc-list 可能返回多个字体名称（用逗号分隔）
        const fonts = line.split(',')
        for (const font of fonts) {
          const fontName = font.trim()
          if (fontName) {
            fontSet.add(fontName)
          }
        }
      }
    }
    
    return Array.from(fontSet).sort()
  } catch (error) {
    console.error('获取 Linux 字体失败:', error)
    return []
  }
}

/**
 * 常用字体列表（作为后备）
 */
const commonFonts = [
  'Arial',
  'Arial Black',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Impact',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  '微软雅黑',
  'Microsoft YaHei',
  '黑体',
  'SimHei',
  '宋体',
  'SimSun',
  '新宋体',
  'NSimSun',
  '仿宋',
  'FangSong',
  '楷体',
  'KaiTi',
  '华文细黑',
  'STXihei',
  '华文楷体',
  'STKaiti',
  '华文宋体',
  'STSong',
  '华文仿宋',
  'STFangsong',
  '方正舒体',
  'FZShuTi',
  '方正姚体',
  'FZYaoti'
]

/**
 * 获取系统所有可用字体
 * 处理流程：
 * 1、按运行平台调用对应字体读取方法。
 * 2、结果过少或查询异常时使用常用字体列表。
 * @returns {Promise<string[]>} 字体列表
 */
export async function getSystemFonts() {
  try {
    let fonts = []
    
    // 1、根据平台选择对应的获取方法。
    if (process.platform === 'win32') {
      fonts = await getWindowsFonts()
    } else if (process.platform === 'darwin') {
      fonts = await getMacFonts()
    } else if (process.platform === 'linux') {
      fonts = await getLinuxFonts()
    }
    
    // 2、如果获取失败或字体数量太少，使用常用字体列表。
    if (fonts.length < 10) {
      console.warn('获取的系统字体数量较少，使用常用字体列表')
      return commonFonts
    }
    
    console.log(`成功获取 ${fonts.length} 个系统字体`)
    return fonts
  } catch (error) {
    console.error('获取系统字体失败:', error)
    return commonFonts
  }
}
