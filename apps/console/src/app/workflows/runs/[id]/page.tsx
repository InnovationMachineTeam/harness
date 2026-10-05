import { RunViewer } from "@/uikit/components/workflows/RunViewer";
import { Page } from "@/uikit";
export default async function WorkflowRunPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Page title="Workflow run" description={id}><RunViewer id={id} /></Page>; }
