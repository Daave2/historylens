import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
    const { data: project } = await supabase.from('projects').select('*').limit(1).single();
    if (!project) return console.log('No project found');
    console.log('Project:', project.name);
    // Fetch places
    const { data: places } = await supabase.from('places').select('*').eq('project_id', project.id);
    console.log(`Found ${places?.length} places`);
}
run();
