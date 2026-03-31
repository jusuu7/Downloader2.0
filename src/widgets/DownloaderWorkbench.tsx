import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Copy,
  ImagePlus,
  FolderOpen,
  LoaderCircle,
  Save,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";

import {
  DEFAULT_CONFIG,
  type ResultItem,
  type TaskItem,
  detectPlatforms,
  generatePreview,
  loadConfig,
  loadFiles,
  loadTasks,
  openDirectory,
  saveConfig,
} from "../lib/downloader-api";
import { Field } from "../primitives/Field";
import { GlassPanel } from "../primitives/GlassPanel";
import { RoundButton } from "../primitives/RoundButton";
import { SectionTitle } from "../primitives/SectionTitle";
import { PreviewModal } from "./PreviewModal";
import styles from "./DownloaderWorkbench.module.css";

function getOpenDirPayload(task: TaskItem | null, workPath: string) {
  if (task?.downloadDir || task?.download_dir) {
    return { path: task.downloadDir ?? task.download_dir };
  }
  if (workPath) {
    return { path: workPath };
  }
  return {};
}

const META_PREFIX_PATTERN =
  /^(原始链接|解析链接|实际链接|标准链接|作品ID|作者(?:ID)?|发布时间|作品类型|商品ID|卖家|城市|价格|图片数量|视频数量|视频下载成功|视频下载失败|Thread ID|Author|Original URL|Final URL)\s*[:：]/i;

function extractCopyText(rawText: string) {
  const blocks = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const extracted: string[] = [];
  for (const block of blocks) {
    if (META_PREFIX_PATTERN.test(block)) continue;
    if (/^(Prompt|Reply)\s*:/i.test(block)) {
      const content = block.replace(/^(Prompt|Reply)\s*:/i, "").trim();
      if (content) extracted.push(content);
      continue;
    }
    extracted.push(block);
  }

  return Array.from(new Set(extracted)).join("\n\n").trim();
}

async function readTextContent(fileUrl: string) {
  const response = await fetch(fileUrl, {
    cache: "no-store",
    headers: { Accept: "text/plain, text/*;q=0.9, */*;q=0.8" },
  });
  if (!response.ok) {
    throw new Error(`读取文案失败：HTTP ${response.status}`);
  }
  return response.text();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function DownloaderWorkbench() {
  const [draftConfig, setDraftConfig] = useState(DEFAULT_CONFIG);
  const [linkInput, setLinkInput] = useState("");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [recentFiles, setRecentFiles] = useState<ResultItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hasGeneratedPreview, setHasGeneratedPreview] = useState(false);
  const [generatedItems, setGeneratedItems] = useState<ResultItem[]>([]);
  const [generatedText, setGeneratedText] = useState("");
  const [previewItem, setPreviewItem] = useState<ResultItem | null>(null);
  const [resultText, setResultText] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isStartingTask, setIsStartingTask] = useState(false);

  const detectedPlatforms = useMemo(() => detectPlatforms(linkInput), [linkInput]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;
  const hasRunningTask = tasks.some((task) => task.status === "running");
  const downloadedGalleryItems = useMemo(
    () =>
      (selectedTask?.results?.length ? selectedTask.results : recentFiles).filter(
        (item) => item.type === "image",
      ),
    [recentFiles, selectedTask],
  );
  const galleryItems = hasGeneratedPreview ? generatedItems : downloadedGalleryItems;
  const displayResultText = hasGeneratedPreview ? generatedText : resultText;
  const resultTextSourceKey = useMemo(
    () =>
      (selectedTask?.results?.length ? selectedTask.results : recentFiles)
        .filter((item) => item.type === "meta")
        .slice(0, 6)
        .map((item) => item.downloadUrl)
        .join("|"),
    [recentFiles, selectedTask],
  );

  const summaryItems = useMemo(
    () => [
      `图片 ${draftConfig.downloadImages ? "开启" : "关闭"} / 视频 ${draftConfig.downloadVideos ? "开启" : "关闭"} / 分平台目录 开启`,
    ],
    [draftConfig],
  );

  void summaryItems;

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const [nextConfig, nextTasks, nextFiles] = await Promise.all([
          loadConfig(),
          loadTasks(),
          loadFiles(),
        ]);

        if (!active) return;

        setDraftConfig(nextConfig);
        setTasks(nextTasks);
        setRecentFiles(nextFiles);
      } catch (error) {
        if (active) {
          toast.error(error instanceof Error ? error.message : "初始化失败");
        }
      } finally {
        if (active) setIsBootstrapping(false);
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  useEffect(() => {
    let cancelled = false;

    const loadResultText = async () => {
      if (!resultTextSourceKey) {
        setResultText("");
        return;
      }

      try {
        const sourceUrls = resultTextSourceKey.split("|").filter(Boolean);
        const rawTexts = await Promise.all(sourceUrls.map((url) => readTextContent(url)));
        const merged = Array.from(
          new Set(rawTexts.map((text) => extractCopyText(text)).filter(Boolean)),
        ).join("\n\n");
        if (!cancelled) {
          setResultText(merged);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("load result text failed", error);
          setResultText("");
        }
      }
    };

    void loadResultText();

    return () => {
      cancelled = true;
    };
  }, [resultTextSourceKey]);

  useEffect(() => {
    if (isBootstrapping) return undefined;

    let cancelled = false;

    const refreshCollections = async () => {
      try {
        const [nextTasks, nextFiles] = await Promise.all([loadTasks(), loadFiles()]);
        if (cancelled) return;
        setTasks(nextTasks);
        setRecentFiles(nextFiles);
      } catch (error) {
        if (!cancelled) {
          console.warn("polling failed", error);
        }
      }
    };

    const timer = window.setInterval(() => {
      void refreshCollections();
    }, hasRunningTask ? 2000 : 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasRunningTask, isBootstrapping]);

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const nextConfig = await saveConfig(draftConfig);
      setDraftConfig(nextConfig);
      toast.success("配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存配置失败");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleStartTask = async () => {
    if (!hasGeneratedPreview || !generatedItems.length) {
      toast.error("请先开始生成");
      return;
    }

    setIsStartingTask(true);
    try {
      for (const item of generatedItems) {
        const link = document.createElement("a");
        link.href = item.downloadUrl;
        link.download = item.name || "image.jpg";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      toast.success(`已发起 ${generatedItems.length} 张图片下载`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    } finally {
      setIsStartingTask(false);
    }
  };

  const handleGenerate = async () => {
    if (!linkInput.trim()) {
      toast.error("请先粘贴下载链接");
      return;
    }

    setIsGenerating(true);
    try {
      const firstPlatform = detectedPlatforms[0];
      const response = await generatePreview({
        ...draftConfig,
        folderMode: true,
        url: linkInput,
        source_mode_hint: firstPlatform === "xianyu" ? "xianyu" : undefined,
      });

      setHasGeneratedPreview(true);
      setGeneratedItems(Array.isArray(response.items) ? response.items : []);
      setGeneratedText(String(response.text || "").trim());
      if (Array.isArray(response.items) && response.items.length) {
        toast.success("图片已生成");
      } else {
        toast.success("已完成生成，但没有可展示图片");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      if (/Unknown endpoint|\/api\/generate/i.test(message)) {
        toast.error("当前后端还是旧版本，请重启 Downloader2.0 服务后再试。");
      } else {
        toast.error(message);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenDirectory = async () => {
    try {
      await openDirectory(getOpenDirPayload(selectedTask, draftConfig.workPath));
      toast.success("已尝试打开目录");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开目录失败");
    }
  };

  return (
    <>
      <main className={styles.shell}>
        <section className={styles.workbench} id="workbench">
          <div className={styles.grid}>
            <GlassPanel tone="strong" className={styles.panel}>
              <div className={styles.inputPanel}>
                <SectionTitle
                  eyebrow="输入区"
                  title="输入链接"
                />

                <div className={styles.inputGrid}>
                  <label className={styles.textAreaField}>
                    <textarea
                      className={styles.textarea}
                      rows={6}
                      placeholder="把小红书、闲鱼、大众点评、豆包的分享链接直接粘贴到这里。"
                      value={linkInput}
                      onChange={(event) => {
                        setLinkInput(event.target.value);
                        setHasGeneratedPreview(false);
                        setGeneratedItems([]);
                        setGeneratedText("");
                      }}
                    />
                  </label>
                </div>

                  <div className={styles.buttonRow}>
                    <RoundButton
                      tone="secondary"
                      className={styles.primaryButton}
                      onClick={handleGenerate}
                      disabled={isGenerating}
                    >
                      {isGenerating ? <LoaderCircle size={16} /> : <ImagePlus size={16} />}
                      <span>{isGenerating ? "生成中..." : "开始生成"}</span>
                    </RoundButton>
                    <RoundButton className={styles.primaryButton} onClick={handleStartTask} disabled={isStartingTask}>
                      {isStartingTask ? <LoaderCircle size={16} /> : <ArrowDownToLine size={16} />}
                      <span>{isStartingTask ? "下载中..." : "开始下载"}</span>
                    </RoundButton>
                  </div>
              </div>
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.outputPanel}>
                <SectionTitle
                  eyebrow="输出区"
                  title="结果区"
                />

                <div className={styles.outputStack}>
                  <section className={styles.outputCard}>
                    <div className={styles.subTitleRow}>
                      <div className={styles.subTitleBlock}>
                        <p className={styles.subTitle}>结果文案</p>
                        <p className={styles.subMeta}>文案会显示在这里哦~</p>
                      </div>
                      {displayResultText ? (
                        <button
                          type="button"
                          className={styles.copyIconButton}
                          aria-label="复制文案"
                          onClick={() => {
                            void copyText(displayResultText)
                              .then(() => toast.success("文案已复制"))
                              .catch((error) =>
                                toast.error(error instanceof Error ? error.message : "复制失败"),
                              );
                          }}
                        >
                          <Copy size={16} />
                        </button>
                      ) : null}
                    </div>

                    {displayResultText ? (
                      <div className={styles.copyTextBox}>
                        <p className={styles.copyText}>{displayResultText}</p>
                      </div>
                    ) : (
                      <div className={styles.empty}>
                        <p>当前还没有可提取的结果文案。完成抓取后会自动显示正文内容。</p>
                      </div>
                    )}
                  </section>

                  <section className={styles.outputCard}>
                    <div className={styles.subTitleRow}>
                      <div>
                        <p className={styles.subTitle}>结果图库</p>
                        <p className={styles.subMeta}>点击图片预览，长按图片保存。</p>
                      </div>
                    </div>

                    {galleryItems.length ? (
                      <div className={styles.galleryGrid}>
                        {galleryItems.map((item) => {
                          return (
                            <article key={item.fileId} className={styles.galleryCard}>
                              <img
                                className={styles.galleryMedia}
                                src={item.mediaUrl}
                                alt={item.name}
                                loading="lazy"
                                onClick={() => setPreviewItem(item)}
                              />
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={styles.empty}>
                        <p>结果图库还是空的。任务完成后，这里只显示下载到的图片。</p>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.settingsPanel}>
                <SectionTitle
                  eyebrow="设置区"
                  title="配置"
                />

                <div className={styles.toggleRow}>
                  <button
                    className={styles.toggleChip}
                    data-active={draftConfig.downloadImages}
                    type="button"
                    onClick={() =>
                      setDraftConfig((prev) => ({ ...prev, downloadImages: !prev.downloadImages }))
                    }
                  >
                    图片下载
                  </button>
                  <button
                    className={styles.toggleChip}
                    data-active={draftConfig.downloadVideos}
                    type="button"
                    onClick={() =>
                      setDraftConfig((prev) => ({ ...prev, downloadVideos: !prev.downloadVideos }))
                    }
                  >
                    视频下载
                  </button>
                </div>

                <div className={styles.toolbarRow}>
                  <RoundButton tone="secondary" onClick={handleSaveConfig} disabled={isSavingConfig}>
                    {isSavingConfig ? <LoaderCircle size={16} /> : <Save size={16} />}
                    <span>{isSavingConfig ? "保存中..." : "保存配置"}</span>
                  </RoundButton>

                  <RoundButton tone="ghost" onClick={() => setDrawerOpen(true)}>
                    <Settings2 size={16} />
                    <span>高级设置</span>
                  </RoundButton>

                  <RoundButton tone="ghost" onClick={handleOpenDirectory}>
                    <FolderOpen size={16} />
                    <span>打开目录</span>
                  </RoundButton>
                </div>
              </div>
            </GlassPanel>
          </div>
        </section>
      </main>

      {drawerOpen ? (
        <div className={styles.drawerRoot}>
          <button
            aria-label="关闭高级设置"
            className={styles.drawerBackdrop}
            type="button"
            onClick={() => setDrawerOpen(false)}
          />
          <GlassPanel className={styles.drawer} tone="strong">
            <div className={styles.drawerHeader}>
              <SectionTitle
                eyebrow="高级设置"
                title="下载目录&Cookie"
              />
              <RoundButton tone="ghost" onClick={() => setDrawerOpen(false)}>
                关闭
              </RoundButton>
            </div>

            <div className={styles.drawerBody}>
              <section className={styles.drawerGroup}>
                <div className={styles.fieldStack}>
                  <Field
                    label="工作目录"
                    placeholder="留空时使用服务端默认目录"
                    value={draftConfig.workPath}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({ ...prev, workPath: event.target.value }))
                    }
                  />
                  <Field
                    label="文件夹名"
                    value={draftConfig.folderName}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({ ...prev, folderName: event.target.value }))
                    }
                  />
                  <Field
                    label="并发数"
                    type="number"
                    min={1}
                    max={8}
                    value={String(draftConfig.concurrency)}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        concurrency: Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                      }))
                    }
                  />
                  <Field
                    label="超时（秒）"
                    type="number"
                    min={5}
                    value={String(draftConfig.timeout)}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        timeout: Math.max(5, Number(event.target.value) || DEFAULT_CONFIG.timeout),
                      }))
                    }
                  />
                  <Field
                    label="重试次数"
                    type="number"
                    min={0}
                    max={5}
                    value={String(draftConfig.maxRetry)}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        maxRetry: Math.max(0, Number(event.target.value) || 0),
                      }))
                    }
                  />
                  <Field
                    label="代理"
                    placeholder="http://127.0.0.1:7890"
                    value={draftConfig.proxy}
                    onChange={(event) =>
                      setDraftConfig((prev) => ({ ...prev, proxy: event.target.value }))
                    }
                  />
                </div>
              </section>

              <section className={styles.drawerGroup}>
                <div className={styles.fieldStack}>
                  <label className={styles.textAreaField}>
                    <span className={styles.fieldLabel}>小红书 Cookie</span>
                    <textarea
                      className={`${styles.textarea} ${styles.textareaShort}`}
                      rows={3}
                      placeholder="用于小红书详情页与主页展开"
                      value={draftConfig.xhsCookie}
                      onChange={(event) =>
                        setDraftConfig((prev) => ({ ...prev, xhsCookie: event.target.value }))
                      }
                    />
                  </label>

                  <label className={styles.textAreaField}>
                    <span className={styles.fieldLabel}>豆包 Cookie</span>
                    <textarea
                      className={`${styles.textarea} ${styles.textareaShort}`}
                      rows={3}
                      placeholder="用于豆包线程图片下载"
                      value={draftConfig.doubaoCookie}
                      onChange={(event) =>
                        setDraftConfig((prev) => ({ ...prev, doubaoCookie: event.target.value }))
                      }
                    />
                  </label>
                </div>
              </section>
            </div>
          </GlassPanel>
        </div>
      ) : null}

      <PreviewModal item={previewItem} items={galleryItems} onClose={() => setPreviewItem(null)} />
    </>
  );
}
