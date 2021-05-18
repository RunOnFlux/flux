import HelloWorld from '@/components/HelloWorld';
import { shallowMount } from '@vue/test-utils';
import { expect } from 'chai';

describe('HelloWorld', () => {
  it('renders props.msg when passed', () => {
    const msg = 'new message';
    const wrapper = shallowMount(HelloWorld, {
      propsData: { msg },
    });
    expect(wrapper.text()).to.include(msg);
  });
});
