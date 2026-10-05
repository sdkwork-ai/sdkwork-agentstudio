import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  ArrowLeft,
  Bold,
  Code,
  Heading2,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  Loader2,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sdkwork/agentstudio-pc-ui';
import {
  communityService,
  llmService,
  type CommunityDeliveryMode,
  type CommunityServiceLine,
} from '../../services';
import { createCommunityCoverUploadService } from '@sdkwork/agentstudio-pc-core/services/communityCoverUploadService';
import { toast } from 'sonner';

const CATEGORY_IDS = ['job-seeking', 'recruitment', 'services', 'partnerships', 'news'] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];

const PUBLISHER_TYPES = ['personal', 'company', 'official'] as const;
type PublisherType = (typeof PUBLISHER_TYPES)[number];
const SERVICE_LINES = [
  'legal',
  'tax',
  'design',
  'development',
  'marketing',
  'translation',
  'operations',
  'training',
  'consulting',
  'content',
  'data',
  'hr',
] as const;
const DELIVERY_MODES = ['online', 'hybrid', 'onsite'] as const;

export function NewPostWorkspace() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CategoryId>('job-seeking');
  const [publisherType, setPublisherType] = useState<PublisherType>('personal');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [compensation, setCompensation] = useState('');
  const [serviceLine, setServiceLine] = useState<CommunityServiceLine>('legal');
  const [deliveryMode, setDeliveryMode] = useState<CommunityDeliveryMode>('online');
  const [turnaround, setTurnaround] = useState('');
  const [contactPreference, setContactPreference] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categoryOptions = [
    { value: 'job-seeking' as const, label: t('community.newPost.entryTypes.jobSeeking') },
    { value: 'recruitment' as const, label: t('community.newPost.entryTypes.recruitment') },
    { value: 'services' as const, label: t('community.newPost.entryTypes.services') },
    { value: 'partnerships' as const, label: t('community.newPost.entryTypes.partnerships') },
    { value: 'news' as const, label: t('community.newPost.entryTypes.news') },
  ];
  const publisherOptions = PUBLISHER_TYPES.map((item) => ({
    value: item,
    label: t(`community.newPost.publisherTypes.${item}`),
  }));
  const serviceLineOptions = SERVICE_LINES.map((item) => ({
    value: item,
    label: t(`community.newPost.serviceLines.${item}`),
  }));
  const deliveryModeOptions = DELIVERY_MODES.map((item) => ({
    value: item,
    label: t(`community.newPost.deliveryModes.${item}`),
  }));
  const isServiceEntry = category === 'services';
  const assistantActions = [
    t('community.newPost.assistantActions.polish'),
    t('community.newPost.assistantActions.duplicate'),
    t('community.newPost.assistantActions.match'),
  ];

  useEffect(() => {
    if (category === 'news') {
      setPublisherType('official');
      setCompany((previous) => previous || 'OpenClaw');
      setLocation((previous) => previous || t('community.newPost.defaults.newsLocation'));
      setCompensation((previous) => previous || t('community.newPost.defaults.newsCompensation'));
    }
  }, [category, t]);

  useEffect(() => {
    if (category === 'services') {
      setLocation((previous) => previous || t('community.newPost.defaults.serviceLocation'));
      setCompensation((previous) => previous || t('community.newPost.defaults.serviceCompensation'));
      setTurnaround((previous) => previous || t('community.newPost.defaults.serviceTurnaround'));
    }
  }, [category, t]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: t('community.newPost.editorPlaceholder'),
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-2xl max-w-full h-auto my-6',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary-500 underline underline-offset-4 decoration-primary-500/30 hover:decoration-primary-500 transition-colors cursor-pointer',
        },
      }),
      Highlight.configure({
        HTMLAttributes: {
          class: 'bg-yellow-200 dark:bg-yellow-500/30 text-inherit rounded-sm px-1',
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'prose prose-zinc dark:prose-invert prose-lg max-w-none min-h-[24rem] focus:outline-none prose-headings:font-bold prose-p:leading-relaxed prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800',
      },
    },
  });

  const handleAddTag = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && tagInput.trim()) {
      event.preventDefault();
      if (!tags.includes(tagInput.trim()) && tags.length < 5) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    // The cover uploads through the shared Drive cover service and the post
    // stores the `drive://` reference — a locally-read base64 data URL would
    // be a fake upload (`DRIVE_SPEC.md` §18). The local object URL is
    // presentation-only preview state and never persisted.
    const previewUrl = URL.createObjectURL(file);
    setCoverImage(previewUrl);
    void createCommunityCoverUploadService()
      .uploadCover(file)
      .then((uri) => {
        setCoverImage(uri);
      })
      .catch(() => {
        toast.error(t('community.newPost.toasts.coverUploadFailed'));
        setCoverImage('');
      })
      .finally(() => {
        URL.revokeObjectURL(previewUrl);
      });
  };

  const addImage = () => {
    const url = window.prompt(t('community.newPost.prompts.imageUrl'));
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const setLink = () => {
    const previousUrl = editor?.getAttributes('link').href;
    const url = window.prompt(t('community.newPost.prompts.linkUrl'), previousUrl);
    if (url === null) {
      return;
    }
    if (url === '') {
      editor?.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim() || !editor) {
      return;
    }

    setIsGenerating(true);
    try {
      const generatedText = await llmService.generateContent({
        prompt: aiPrompt,
        context: `${title ? `Title: ${title}\n` : ''}${editor.getText()}`,
        systemInstruction:
          category === 'services'
            ? 'You are helping publish an online-deliverable service listing. Return only the requested markdown content.'
            : 'You are helping publish a recruitment-first classified listing. Return only the requested markdown content.',
      });

      if (generatedText) {
        const htmlContent = generatedText
          .replace(/^### (.*$)/gim, '<h3>$1</h3>')
          .replace(/^## (.*$)/gim, '<h2>$1</h2>')
          .replace(/^# (.*$)/gim, '<h1>$1</h1>')
          .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/gim, '<em>$1</em>')
          .replace(/\n/gim, '<br>');

        editor.chain().focus().insertContent(htmlContent).run();
        setAiPrompt('');
        setShowAIPrompt(false);
        toast.success(t('community.newPost.toasts.contentGenerated'));
      }
    } catch (error: any) {
      console.error('AI Generation failed:', error);
      toast.error(error.message || t('community.newPost.toasts.generateFailed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error(t('community.newPost.toasts.enterTitle'));
      return;
    }

    if (!editor?.getHTML() || editor.getText().trim() === '') {
      toast.error(t('community.newPost.toasts.enterContent'));
      return;
    }

    if (!location.trim()) {
      toast.error(t('community.newPost.toasts.enterLocation'));
      return;
    }

    if (!compensation.trim()) {
      toast.error(t('community.newPost.toasts.enterCompensation'));
      return;
    }

    if (category === 'services' && !serviceLine) {
      toast.error(t('community.newPost.toasts.enterServiceLine'));
      return;
    }

    if (category === 'services' && !deliveryMode) {
      toast.error(t('community.newPost.toasts.enterDeliveryMode'));
      return;
    }

    if (category === 'services' && !turnaround.trim()) {
      toast.error(t('community.newPost.toasts.enterTurnaround'));
      return;
    }

    setIsSubmitting(true);
    try {
      const newPost = await communityService.createPost({
        title,
        content: editor.getHTML(),
        category,
        publisherType,
        company: company || undefined,
        location,
        compensation,
        serviceLine: category === 'services' ? serviceLine : undefined,
        deliveryMode: category === 'services' ? deliveryMode : undefined,
        turnaround: category === 'services' ? turnaround : undefined,
        employmentType:
          category === 'recruitment'
            ? t('community.newPost.employmentTypes.fullTime')
            : category === 'job-seeking'
              ? t('community.newPost.employmentTypes.candidateOpen')
              : category === 'news'
                ? t('community.newPost.employmentTypes.news')
                : t('community.newPost.employmentTypes.project'),
        contactPreference: contactPreference || undefined,
        tags,
        coverImage: coverImage || undefined,
        assistantActions: category === 'services' ? undefined : assistantActions,
      });

      toast.success(t('community.newPost.toasts.publishSuccess'));
      navigate(`/community/${newPost.id}`);
    } catch (error) {
      console.error('Failed to create post:', error);
      toast.error(t('community.newPost.toasts.publishFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!editor) {
    return null;
  }

  return (
    <div className="min-h-full bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_24%,_#f8fafc_100%)] dark:bg-[linear-gradient(180deg,_#09090b_0%,_#101827_30%,_#09090b_100%)]">
      <div className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/community')}
              className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              <span>{t('community.page.title')}</span>
              <span>/</span>
              <span className="text-zinc-900 dark:text-zinc-100">{t('community.newPost.draft')}</span>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('community.newPost.publish')}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10 pb-28">
        <div className="mb-8 rounded-[2rem] bg-[linear-gradient(135deg,_#0f172a_0%,_#1d4ed8_58%,_#1e293b_100%)] p-7 text-white shadow-[0_24px_80px_rgba(29,78,216,0.22)]">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
            <Sparkles className="h-3.5 w-3.5" />
            {t('community.newPost.hero.badge')}
          </div>
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">
            {t('community.newPost.hero.title')}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-blue-50/85 md:text-base">
            {t('community.newPost.hero.description')}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.35fr_0.8fr]">
          <div className="space-y-8">
            {coverImage ? (
              <div className="group relative h-72 overflow-hidden rounded-[2rem]">
                <img
                  src={coverImage}
                  alt={t('community.newPost.coverAlt')}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 flex items-center justify-center gap-4 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 font-medium text-white backdrop-blur-md transition-colors hover:bg-white/30"
                  >
                    <Upload className="h-4 w-4" />
                    {t('community.newPost.changeCover')}
                  </button>
                  <button
                    onClick={() => setCoverImage('')}
                    className="rounded-xl bg-rose-500/85 px-4 py-2 font-medium text-white transition-colors hover:bg-rose-500"
                  >
                    {t('community.newPost.removeCover')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-zinc-500"
              >
                <ImagePlus className="h-4 w-4" />
                {t('community.newPost.addCover')}
              </button>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleCoverUpload}
              accept="image/*"
              className="hidden"
            />

            <div className="rounded-[2rem] border border-zinc-200 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.fields.entryType')}
                  </label>
                  <Select value={category} onValueChange={(value) => setCategory(value as CategoryId)}>
                    <SelectTrigger className="rounded-2xl bg-zinc-50 dark:bg-zinc-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.fields.publisherType')}
                  </label>
                  <Select
                    value={publisherType}
                    onValueChange={(value) => setPublisherType(value as PublisherType)}
                  >
                    <SelectTrigger className="rounded-2xl bg-zinc-50 dark:bg-zinc-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {publisherOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.fields.location')}
                  </label>
                  <Input
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder={
                      isServiceEntry
                        ? t('community.newPost.defaults.serviceLocation')
                        : t('community.newPost.placeholders.location')
                    }
                    className="rounded-2xl bg-zinc-50 dark:bg-zinc-900"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.fields.compensation')}
                  </label>
                  <Input
                    value={compensation}
                    onChange={(event) => setCompensation(event.target.value)}
                    placeholder={
                      isServiceEntry
                        ? t('community.newPost.defaults.serviceCompensation')
                        : t('community.newPost.placeholders.compensation')
                    }
                    className="rounded-2xl bg-zinc-50 dark:bg-zinc-900"
                  />
                </div>

                {isServiceEntry ? (
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      {t('community.newPost.fields.serviceLine')}
                    </label>
                    <Select
                      value={serviceLine}
                      onValueChange={(value) => setServiceLine(value as CommunityServiceLine)}
                    >
                      <SelectTrigger className="rounded-2xl bg-zinc-50 dark:bg-zinc-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {serviceLineOptions.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {isServiceEntry ? (
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      {t('community.newPost.fields.deliveryMode')}
                    </label>
                    <Select
                      value={deliveryMode}
                      onValueChange={(value) => setDeliveryMode(value as CommunityDeliveryMode)}
                    >
                      <SelectTrigger className="rounded-2xl bg-zinc-50 dark:bg-zinc-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {deliveryModeOptions.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.fields.company')}
                  </label>
                  <Input
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    placeholder={t('community.newPost.placeholders.company')}
                    className="rounded-2xl bg-zinc-50 dark:bg-zinc-900"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.fields.contactPreference')}
                  </label>
                  <Input
                    value={contactPreference}
                    onChange={(event) => setContactPreference(event.target.value)}
                    placeholder={t('community.newPost.placeholders.contactPreference')}
                    className="rounded-2xl bg-zinc-50 dark:bg-zinc-900"
                  />
                </div>

                {isServiceEntry ? (
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      {t('community.newPost.fields.turnaround')}
                    </label>
                    <Input
                      value={turnaround}
                      onChange={(event) => setTurnaround(event.target.value)}
                      placeholder={t('community.newPost.defaults.serviceTurnaround')}
                      className="rounded-2xl bg-zinc-50 dark:bg-zinc-900"
                    />
                  </div>
                ) : null}
              </div>

              <Input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('community.newPost.titlePlaceholder')}
                className="mt-6 mb-6 h-auto border-0 bg-transparent px-0 py-0 text-4xl font-black shadow-none placeholder:text-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent dark:placeholder:text-zinc-700 sm:text-5xl"
              />

              <div className="mb-6 flex flex-wrap items-center gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    #{tag}
                    <button onClick={() => handleRemoveTag(tag)} className="ml-1 hover:text-rose-500">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {tags.length < 5 ? (
                  <Input
                    type="text"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={handleAddTag}
                    placeholder={tags.length === 0 ? t('community.newPost.addTags') : t('community.newPost.addTag')}
                    className="h-auto w-40 border-0 bg-transparent px-0 py-0 text-sm text-zinc-500 shadow-none placeholder:text-zinc-400 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent dark:text-zinc-400 dark:placeholder:text-zinc-600"
                  />
                ) : null}
              </div>

              <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <button
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <Bold className="h-4 w-4" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <Italic className="h-4 w-4" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <Heading2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <Code className="h-4 w-4" />
                </button>
                <button
                  onClick={setLink}
                  className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <LinkIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={addImage}
                  className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowAIPrompt((previous) => !previous)}
                  className="ml-auto inline-flex items-center gap-2 rounded-xl bg-primary-600 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-primary-700"
                >
                  <Sparkles className="h-4 w-4" />
                  {t('community.newPost.ai.askAi')}
                </button>
              </div>

              {showAIPrompt ? (
                <div className="mb-4 flex items-center gap-2 rounded-2xl border border-primary-200 bg-primary-50/80 p-3 dark:border-primary-500/20 dark:bg-primary-500/10">
                  <Input
                    type="text"
                    value={aiPrompt}
                    onChange={(event) => setAiPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleGenerateAI();
                      }
                    }}
                    placeholder={t('community.newPost.ai.promptPlaceholder')}
                    className="flex-1 rounded-2xl bg-white dark:bg-zinc-900"
                    disabled={isGenerating}
                  />
                  <button
                    onClick={() => void handleGenerateAI()}
                    disabled={!aiPrompt.trim() || isGenerating}
                    className="rounded-xl bg-primary-600 p-2 text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                  >
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              ) : null}

              <EditorContent editor={editor} />
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[2rem] border border-zinc-200 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-100">
                  {t('community.newPost.assistantPanel.title')}
                </h2>
              </div>
              <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
                {t('community.newPost.assistantPanel.description')}
              </p>
              <div className="mt-5 space-y-3">
                <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                  <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {t('community.newPost.assistantCards.jobSeeking')}
                  </div>
                  <div className="mt-1 text-xs leading-6 text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.assistantCards.jobSeekingDescription')}
                  </div>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                  <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {t('community.newPost.assistantCards.recruitment')}
                  </div>
                  <div className="mt-1 text-xs leading-6 text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.assistantCards.recruitmentDescription')}
                  </div>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                  <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {t('community.newPost.assistantCards.distribution')}
                  </div>
                  <div className="mt-1 text-xs leading-6 text-zinc-500 dark:text-zinc-400">
                    {t('community.newPost.assistantCards.distributionDescription')}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-zinc-200 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70">
              <h2 className="text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-100">
                {t('community.newPost.publishChecklist.title')}
              </h2>
              <div className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
                <div>{t('community.newPost.publishChecklist.items.structured')}</div>
                <div>{t('community.newPost.publishChecklist.items.headline')}</div>
                <div>{t('community.newPost.publishChecklist.items.contact')}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
