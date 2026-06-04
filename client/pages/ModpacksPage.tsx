/* eslint-disable */
import React from 'react';
import ModpacksContainer from './ModpacksContainer';
// @ts-ignore
import PageContentBlock from '@/components/elements/PageContentBlock';

export default function ModpacksPage() {
    return (
        <PageContentBlock title={'Modpacks'} showFlashKey={'server:modpacks'}>
            <ModpacksContainer />
        </PageContentBlock>
    );
}
